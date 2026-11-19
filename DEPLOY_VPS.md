# Deploy Album on your own VPS (Ubuntu or Debian)

Everything runs on one server: Caddy (HTTPS and the website), the Album API (Node, managed by systemd),
PostgreSQL 17 (only reachable from the server itself). Photos live in Cloudflare R2 (private buckets).
The app is installed in /var/www/album. Secrets live only in /etc/album (never in the app folder, never in chat).

## 0. Check first
- The domain. You wrote `flickr.kokofiobo.com`. Earlier it was `album.kokofibo.com`. Make sure the spelling is exactly the domain you own.
- DNS: an A record for the domain pointing to the VPS IP. If the DNS is on Cloudflare, set that record to "DNS only" (grey cloud).
  Check from your PC:  nslookup flickr.kokofiobo.com   -> must show the VPS IP.
- A Linux user on the VPS with sudo and SSH key login.

## 1. Cloudflare R2 (photos and backups)
1. Dashboard > R2 Object Storage > Create bucket: one for photos (for example `album-photos`) and one for backups (`album-backups`).
   Keep both private: no public access, no r2.dev address, no custom domain.
2. R2 > Manage R2 API Tokens > Create API token > permission "Object Read & Write" > apply to BOTH buckets > Create.
   Copy the Access Key ID and the Secret Access Key (shown once). Your Account ID is on the R2 overview page.
Keep these in a password manager. The installer asks for them and stores them in /etc/album/album.env (readable by root and the service only).

## 2. Upload the app (from Git Bash on your PC)
    cd ~/OneDrive/Desktop/photo-album
    tar --exclude=node_modules --exclude=.wrangler --exclude=dist --exclude=.env --exclude=tests/.env --exclude=worker/.dev.vars --exclude=supabase --exclude=.git -czf /tmp/album.tar.gz .
    scp /tmp/album.tar.gz YOUR_USER@VPS_IP:/tmp/
This leaves out every secret file (.env, db/.env, tests/.env, .dev.vars).

## 3. Install (on the VPS)
    ssh YOUR_USER@VPS_IP
    sudo mkdir -p /var/www/album
    sudo tar -xzf /tmp/album.tar.gz -C /var/www/album && rm /tmp/album.tar.gz
    cd /var/www/album && sudo bash deploy/install.sh
The script asks for: domain, first administrator's email, the R2 details, and (optionally) the Resend key. It then installs the
packages, creates the database and roles with random passwords, applies the migrations, builds the site and the API, starts the
services, sets up the firewall (SSH, 80, 443 only), fail2ban, automatic security updates, the daily cleanup (03:00) and the daily
encrypted backup (02:15). It can be run again safely.
At the end it tells you to copy the backup password: `sudo cat /etc/album/backup.pass` -> password manager. Without it a backup cannot be restored.

## 4. First administrator
Open https://YOUR_DOMAIN/register?bootstrap=1 and register with the administrator email you gave the installer.
Verification emails are sent by Resend. If you skipped Resend, the link is written to the log instead:
    sudo journalctl -u album-api | grep -A1 "dev email"
To add Resend later: sudo nano /etc/album/album.env (RESEND_API_KEY and MAIL_FROM), then: sudo systemctl restart album-api

## 5. Checks after the first start
    systemctl status album-api caddy                 -> both active (running)
    curl -I https://YOUR_DOMAIN                      -> 200 with Strict-Transport-Security
    curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/dev/mail      -> 404 (development pages must not exist)
    sudo systemctl start album-cleanup.service       -> then Admin > Background Jobs shows a run
    sudo systemctl start album-backup.service        -> a file appears in /var/backups/album and in the backup bucket
Then sign in, upload a photo, and look at the photos bucket in the Cloudflare dashboard: users/<id>/... objects must appear.

## 6. Phones (Android and iPhone), over HTTPS
Open the site on the phone: Add Photos from the gallery (several at once), Take Photo, open a guest link, swipe in the viewer, bottom
navigation, theme switch, sign out and in again.

## 7. Updating later
Repeat step 2 (new tar and scp), then on the VPS:
    cd /var/www/album && sudo tar -xzf /tmp/album.tar.gz -C /var/www/album && sudo bash deploy/update.sh

## 8. Restoring a backup (practise this once)
    sudo gpg --batch --pinentry-mode loopback --passphrase-file /etc/album/backup.pass -d /var/backups/album/FILE.dump.gpg > /tmp/restore.dump
    sudo -u postgres createdb album_restore -O album_owner
    sudo -u postgres pg_restore -d album_restore --no-owner --role=album_owner /tmp/restore.dump
    sudo -u postgres psql -d album_restore -c "select count(*) from public.photos"
    sudo -u postgres dropdb album_restore; rm /tmp/restore.dump

## 9. Harden SSH (only after you have confirmed key login works; keep a second session open)
    sudo nano /etc/ssh/sshd_config.d/50-hardening.conf
        PasswordAuthentication no
        PermitRootLogin no
    sudo systemctl reload ssh

## Troubleshooting
| Symptom | Look at |
|---|---|
| Site does not load or certificate error | DNS points to the VPS? `sudo journalctl -u caddy -n 50` |
| "Something went wrong" on actions | `sudo journalctl -u album-api -n 50` |
| Upload fails | R2 token covers the bucket? `sudo journalctl -u album-api -n 50` |
| Cannot sign in after changing .env | `sudo systemctl restart album-api` |
