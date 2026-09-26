# hackAIthon finals: scoring and people's choice

A small web app with three pages:

- `/committee` for the three committee members to score each finalist
- `/vote` for attendees to vote for people's choice (opened from a QR code)
- `/admin` for you: open and close voting, lock scoring, see results, show the QR code and reveal the winners on the projector

No dependencies. Needs Node 18 or later. Data is saved to `data/data.json`.

## Before you deploy

Edit `config.json`, or set these as environment variables (environment variables win):

| Setting | Default | Change it? |
|---|---|---|
| `ADMIN_PIN` | `change-this-pin` | Yes, always |
| `COMMITTEE_PIN` | `2809` | Optional |
| `PORT` | `8080` | Only if your host needs it |

Finalists and committee names are in `config.json`.

## Run it locally

```
node server.js
```

Then open http://localhost:8080/admin

## Deploy on DigitalOcean

### Option 1: Droplet (data is kept on disk)

1. Create an Ubuntu 24.04 Droplet (the smallest size is enough).
2. Install Node: `sudo apt update && sudo apt install -y nodejs`
3. Copy this folder to the Droplet, for example to `/opt/finals`.
4. Create `/etc/systemd/system/finals.service`:

```
[Unit]
Description=hackAIthon finals
After=network.target

[Service]
WorkingDirectory=/opt/finals
ExecStart=/usr/bin/node server.js
Environment=PORT=80
Environment=ADMIN_PIN=your-admin-pin
Environment=COMMITTEE_PIN=your-committee-pin
Restart=always

[Install]
WantedBy=multi-user.target
```

5. Start it: `sudo systemctl enable --now finals`
6. Open `http://YOUR_DROPLET_IP/admin`

For HTTPS on a domain, put Caddy in front: `sudo caddy reverse-proxy --from your.domain --to localhost:8080` (and set `PORT=8080` in the service).

### Option 2: App Platform (quickest, HTTPS included)

1. Push this folder to a GitHub repository.
2. In App Platform, create an app from the repository. Run command: `npm start`.
3. Add `ADMIN_PIN` and `COMMITTEE_PIN` as environment variables.

App Platform storage is temporary: data is lost if the app restarts or redeploys. That is fine for a one-hour session, but do not redeploy during the event, and download the CSV as soon as the winners are revealed.

## On the day

1. Before the session: open `/admin`, go to Reset, choose Everything and type RESET to clear test data.
2. Committee members open `/committee` on their phones, enter the committee PIN and choose their name.
3. Committee members score each finalist right after its Q&A. You can follow progress on `/admin`.
4. After the fifth pitch: select Open voting, then Show voting QR on the projector.
5. After a few minutes: select Close voting.
6. When the committee panel shows 15 of 15 scorecards complete, select Lock scoring.
7. Select Reveal winners on the projector. Space or the right arrow key moves to the next step.
8. Select Download results (CSV) to keep a copy.

## Scoring rules

- Five criteria, each scored 1 to 5, equal weight: value, feasibility, risk (5 means low risk), originality, presentation.
- Each member's total is out of 25. A finalist's result is the average of the members' totals.
- Only complete scorecards count. The admin page warns you if any are missing.
- Ties on total go to the higher average value score, then feasibility. If still tied, the page says so and the chair decides.
- People's choice: one vote per phone. The vote is anonymous.
