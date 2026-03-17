# SiteMapper — Railway Deployment Guide

## Prerequisites

- A [Railway](https://railway.app) account
- A [GoDaddy](https://godaddy.com) domain
- [Git](https://git-scm.com/) installed locally

---

## Step 1: Push to GitHub

Railway deploys from a Git repo. Create one:

```bash
cd sitemap-tool
git init
git add .
git commit -m "Initial commit"
```

Create a new repo on GitHub (e.g. `sitemapper`), then push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/sitemapper.git
git branch -M main
git push -u origin main
```

---

## Step 2: Create a Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Deploy from GitHub repo"**
3. Select your `sitemapper` repo
4. Railway will auto-detect the `Dockerfile` and start building

---

## Step 3: Add a Persistent Volume

Crawl data and screenshots are stored on disk. Without a volume, they're lost on each deploy.

1. In your Railway project, click the service
2. Go to **Settings → Volumes**
3. Click **"Add Volume"**
4. Set:
   - **Mount path:** `/app/data`
   - **Size:** 1 GB (increase later if needed)
5. Save — Railway will redeploy

---

## Step 4: Set Environment Variables

In your Railway service, go to **Variables** and add:

| Variable | Value |
|---|---|
| `CHROME_PATH` | `/usr/bin/chromium` |
| `DATA_DIR` | `/app/data` |
| `PORT` | `5000` |

Railway auto-sets `PORT` but adding it explicitly doesn't hurt.

---

## Step 5: Connect Your GoDaddy Domain

### In Railway:

1. Go to your service → **Settings → Domains**
2. Click **"+ Custom Domain"**
3. Enter your domain (e.g. `sitemapper.yourdomain.com`)
4. Railway will show you a **CNAME target** (something like `your-service.up.railway.app`)

### In GoDaddy:

1. Go to [GoDaddy DNS Management](https://dcc.godaddy.com/dns)
2. Select your domain
3. Add a new DNS record:
   - **Type:** CNAME
   - **Name:** `sitemapper` (or whatever subdomain you chose)
   - **Value:** the Railway CNAME target from above
   - **TTL:** 600

4. If you want to use the root domain (e.g. `yourdomain.com` without a subdomain):
   - You'll need an **A record** instead
   - Railway provides IP addresses for root domain setup in the custom domain settings

5. Wait 5-15 minutes for DNS to propagate

---

## Step 6: Enable HTTPS

Railway automatically provisions SSL certificates for custom domains. Once DNS propagates, your site will be available at `https://sitemapper.yourdomain.com`.

---

## Updating the App

After making changes locally:

```bash
git add .
git commit -m "Your change description"
git push
```

Railway auto-deploys on push.

---

## Resource Recommendations

| Plan | RAM | Good for |
|---|---|---|
| Hobby ($5/mo) | 512 MB | Light use, ~20 pages per crawl |
| Pro ($20/mo) | 2 GB+ | Heavy use, 100+ pages per crawl |

Chromium is memory-hungry. For crawls with 50+ pages and screenshots, 1-2 GB RAM is recommended.

---

## Troubleshooting

**Build fails with Chromium errors:**
Railway's Docker builder needs enough memory. If the build OOMs, try the Pro plan.

**Screenshots are blank:**
Make sure `CHROME_PATH` is set to `/usr/bin/chromium` in Railway variables.

**Data lost after redeploy:**
Make sure the volume is mounted at `/app/data` (Step 3).

**Domain not working:**
DNS changes can take up to 48 hours. Check with `dig sitemapper.yourdomain.com` to verify the CNAME is set.
