# Google Cloud

How to run the app on one Google Cloud VM, back it up to your own computer, and shut it down. The server setup itself is the same as [deployment.md](deployment.md). This page covers only what is specific to Google Cloud.

Replace these placeholders everywhere:

| Placeholder | Meaning | Example |
|---|---|---|
| `VM` | The VM's name | `stock-monitor` |
| `ZONE` | The VM's zone | `asia-south1-a` |
| `IP` | The VM's static IP | `34.93.0.1` |
| `HOST` | The app's address. With no domain, use the IP with dashes plus `.sslip.io`. | `34-93-0-1.sslip.io` |

## Setup

All of this is done in the Console (console.cloud.google.com) and in the VM's browser SSH window.

1. **Project.** Create a project, link billing, and enable the **Compute Engine API**. The 300 USD free-trial credit covers this setup, but it expires after 90 days. Then Google stops the VM.
2. **Static IP.** Go to **VPC network → IP addresses → Reserve external static IP address**. Choose Regional, in the same region as the VM.
3. **VM.** Go to **Compute Engine → VM instances → Create instance**:
   - Machine: `e2-standard-2` (8 GB). The browser container alone may use 2 GB.
   - OS: Ubuntu 24.04 LTS, with a 30 GB balanced disk.
   - Networking: tick **Allow HTTP** and **Allow HTTPS**, and set the external IP to the reserved static IP.
   - Security: **No service account**.
4. **Firewall.** Under **VPC network → Firewall**, keep only `default-allow-http`, `default-allow-https` and `default-allow-ssh`.
5. **Address.** If you have a domain, point an A record at `IP`. With no domain, use `HOST` as `<ip-with-dashes>.sslip.io`. It needs no setup.
6. **Docker and Caddy.** Open the VM's **SSH** window and run:

   ```bash
   sudo apt update && sudo apt -y upgrade
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER
   sudo apt install -y caddy git
   ```

   Close the SSH window and open it again.
7. **Docker DNS.** Do this before step 8. On Google Cloud, `169.254.169.254` is both the metadata server and the DNS server. Step 8 blocks it, so Docker needs a public DNS server instead:

   ```bash
   echo '{ "dns": ["8.8.8.8", "1.1.1.1"] }' | sudo tee /etc/docker/daemon.json
   sudo systemctl restart docker
   ```

8. **Block containers from private networks and the metadata server:**

   ```bash
   sudo iptables -I DOCKER-USER -d 169.254.169.254 -j DROP
   sudo iptables -I DOCKER-USER -d 10.0.0.0/8 -j DROP
   sudo iptables -I DOCKER-USER -d 192.168.0.0/16 -j DROP
   sudo apt install -y iptables-persistent   # answer Yes to saving the rules
   ```

9. **Code and `.env`.** Clone the repo, then run `cp .env.example .env && chmod 600 .env` and fill in `.env` as [deployment.md](deployment.md) describes. Set these lines:

   ```
   COOKIE_SECURE=true
   TRUST_PROXY=true
   APP_ORIGIN=https://HOST
   ```

   `TRUST_PROXY=true` is safe here, because Caddy sets `X-Forwarded-For` itself.
10. **HTTPS:**

    ```bash
    echo 'HOST {
        reverse_proxy 127.0.0.1:3000
    }' | sudo tee /etc/caddy/Caddyfile
    sudo systemctl reload caddy
    ```

11. **Start the app and create the owner.** The password needs at least 8 characters, and `create-owner.ts` must print `Owner account created.`

    ```bash
    docker compose up -d --build
    docker compose run --rm api node --import tsx apps/api/src/cli/create-owner.ts
    ```

12. **Check the firewall.** The first command must print `blocked`, and the second must print an IP address:

    ```bash
    docker compose exec api node -e "fetch('http://169.254.169.254',{signal:AbortSignal.timeout(3000)}).then(()=>console.log('OPEN - fix firewall'),()=>console.log('blocked'))"
    docker compose exec api node -e "require('dns').lookup('google.com',(e,a)=>console.log(e||a))"
    ```

**Updating:** `git pull && docker compose up -d --build`. Without `--build`, the old code keeps running.

### If the site cannot be reached

- `curl -s ifconfig.me` on the VM must print the same IP that is in `HOST`. Check `/etc/caddy/Caddyfile` and `APP_ORIGIN` in `.env`.
- `sudo systemctl status caddy` must say `active (running)`. If it doesn't, check `sudo journalctl -u caddy --no-pager | tail -30`.
- The VM must have **Allow HTTP** and **Allow HTTPS** ticked.

## Back up to your computer

You need two things: the database and `.env`. Both hold private data. Keep them outside the repo folder, because the repo is public.

### One-time setup on your Mac

```bash
brew install --cask google-cloud-sdk
gcloud init                      # sign in, pick the project
gcloud compute ssh VM --zone=ZONE --command='echo ok'
```

The first `gcloud compute ssh` creates an SSH key and asks for a passphrase. It must print `ok`.

### Each backup

Run this on your Mac. The app keeps running.

```bash
mkdir -p ~/stock-monitor-backups && chmod 700 ~/stock-monitor-backups
cd ~/stock-monitor-backups

# Database: streamed over SSH, nothing left on the VM
gcloud compute ssh VM --zone=ZONE \
  --command='cd ~/stock-monitor && docker compose exec -T postgres pg_dump -U stock_owner -d stock_monitor -Fc' \
  > stock-monitor-$(date +%F).dump

# .env: holds APP_ENCRYPTION_KEY, without which saved logins cannot be read
gcloud compute scp VM:~/stock-monitor/.env env-$(date +%F) --zone=ZONE
chmod 600 env-$(date +%F) stock-monitor-$(date +%F).dump
```

### Check the backup

```bash
ls -lh ~/stock-monitor-backups
docker run --rm -i postgres:17-alpine pg_restore --list < ~/stock-monitor-backups/stock-monitor-YYYY-MM-DD.dump | head
```

- The dump must be larger than a few kilobytes.
- `pg_restore --list` must print a table of contents, with no error.
- This check needs Docker on your Mac.

### Restore

The restore works on the same VM or on a new one.

1. Copy the files up:

   ```bash
   gcloud compute scp ~/stock-monitor-backups/stock-monitor-YYYY-MM-DD.dump VM:~/ --zone=ZONE
   ```

2. On a new VM, do the setup above, but put the saved `.env` in place of a new one. It must hold the **same `APP_ENCRYPTION_KEY`**. Skip creating the owner, because the owner is in the backup.
3. On the VM, follow "Restore on the same machine" in the [README](../README.md#backup-and-restore). Use `~/stock-monitor-YYYY-MM-DD.dump` as the file.

## Closing the VM

Take a backup first, using the steps above.

| You want | Do this | Still charged |
|---|---|---|
| A pause | **Compute Engine → VM instances → ⋮ → Stop** | The disk, and the static IP, which is billed while reserved even when it's unused. A few USD a month. |
| To resume after a pause | **⋮ → Start**. The IP stays the same, and the app starts by itself. | Normal running cost. |
| To remove the server | Delete the VM, then release the IP (see below). | Nothing |
| To remove everything | **IAM & Admin → Settings → Shut down** the project. | Nothing. Google deletes the project after 30 days. |

### Remove the server

1. Back up, then check the backup.
2. Go to **Compute Engine → VM instances**, tick the VM, and click **Delete**. This also deletes its boot disk.
3. Go to **VPC network → IP addresses**, then on the static IP click **⋮ → Release static address**. Until you release it, the reserved IP keeps costing money.
4. If you made any snapshots, delete them under **Compute Engine → Snapshots**. Also delete any Cloud Storage buckets you made.
5. Under **Billing → Reports**, check that the costs drop to zero over the next day or two.

After deletion, nothing on the server can be recovered. Your backups on your Mac are the only copy.

### When the free trial ends

- Google stops the VM when the 300 USD credit runs out or the 90 days pass, whichever comes first.
- After that, you have about 30 days to upgrade to a paid account before the resources are deleted.
- Take a backup before the trial ends.
