# Raspberry Pi Deployment Guide

To get your Arcade Hub running continuously on your Raspberry Pi and auto-syncing with GitHub, follow these steps.

## 1. Initial Setup on the Raspberry Pi

SSH into your Raspberry Pi and install the required tools (Node.js, Git, and PM2):

```bash
# Install Node.js (if you haven't already. Example uses Node 20)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs npm git

# Install PM2 globally (Process Manager to keep the server running continuously)
sudo npm install -g pm2
```

## 2. Clone Your Repository

Clone the newly created GitHub repository into your home folder:

```bash
cd ~
git clone https://github.com/yuvaraj949/Multilocal-Host.git
cd Multilocal-Host
```

## 3. Make the Deploy Script Executable

We've added a handy `deploy.sh` script to your repo. Make it executable:

```bash
chmod +x deploy.sh
```

## 4. Run the First Deployment

Just run the script. It will build the client, install all dependencies, and start the server using PM2.

```bash
./deploy.sh
```

*(Note: PM2 will start the server on port 3000 and serve the frontend automatically!)*

## 5. Ensure PM2 Starts on Reboot

To make sure your server automatically starts if the Raspberry Pi loses power or reboots:

```bash
# This will output a command you need to copy-paste and run:
pm2 startup

# Then save the current pm2 state:
pm2 save
```

## 6. How to View Your Logs

If you want to view the output from the Node server (including Socket.io events, errors, console.logs, and any crashing issues):

### Server Logs (PM2)

Because the server is run using `pm2`, you can watch the live logs with:

```bash
pm2 logs arcade-hub
```

*To exit the live log view, press `Ctrl+C`.*

### Deployment Logs

If you want to see if your auto-sync worked correctly (e.g., if the pull/build was successful):

```bash
cat ~/deploy.log
```

Or you can stream the latest updates as they happen with:

```bash
tail -f ~/deploy.log
```

---

## 🔁 How to Auto-Sync When You Push an Update

Whenever you push code from your Windows PC to GitHub, you want the Raspberry Pi to pull it and restart. The easiest way without setting up external webhooks (since the Pi is usually behind a home router) is using a **Cron Job**.

To check for updates every 5 minutes:

1. Open the crontab editor on the Pi:

   ```bash
   crontab -e
   ```

2. Add this line at the bottom of the file:

   ```bash
   */5 * * * * cd ~/Multilocal-Host && git fetch && [ $(git rev-parse HEAD) != $(git rev-parse @{u}) ] && ./deploy.sh >> ~/deploy.log 2>&1
   ```

**What this does:**
Every 5 minutes, it fetches from GitHub. If it detects that your local branch is behind the remote (`git rev-parse HEAD != git rev-parse @{u}`), it runs the `./deploy.sh` script and logs the output to `~/deploy.log`.

Now you can just push code to GitHub and the Raspberry Pi will automatically update and restart within 5 minutes!
