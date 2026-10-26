# Guess The Word — self-hosted

A Skribbl-style word-guessing game with a real backend. No Anthropic
account, no organization membership, no login of any kind required for
players — they just type a display name and join.

Two ways to run it:
- **Locally on your own machine** (sections 1–3 below) — free, but your
  machine has to stay on and reachable the whole time.
- **Deployed via GitHub + Heroku** (section 7) — a real public URL that
  stays up without your laptop being involved, costs a few dollars a month.

## 1. Install Node.js

You need [Node.js](https://nodejs.org) (any recent LTS version, e.g. 18+)
installed on the machine that will host the game. Check with:

```
node -v
```

## 2. Install and run

From this folder:

```
npm install
npm start
```

You'll see:

```
Guess The Word running at http://localhost:3000
Admin/control password: itsme
```

Open `http://localhost:3000` in your own browser first to confirm it works.

## 3. Let other people join

Everyone needs to reach the machine you're running this on, over the network.

- **Same WiFi / school network (simplest, recommended):**
  Find your machine's local IP address:
  - Windows: `ipconfig` → look for "IPv4 Address" (e.g. `192.168.1.42`)
  - Mac/Linux: `ifconfig` or `ip addr` → look for something like `192.168.x.x`

  Share `http://<your-ip>:3000` with your 25 classmates — e.g.
  `http://192.168.1.42:3000`. As long as everyone's phone is on the same WiFi,
  this just works, no extra setup.

- **Different networks / mobile data / outside your school WiFi:**
  Your machine isn't reachable from outside your local network by default.
  The easiest fix is a tunneling tool like [ngrok](https://ngrok.com):
  ```
  ngrok http 3000
  ```
  It gives you a public `https://...ngrok-free.app` link you can share with
  anyone, anywhere, without touching your router. (Free ngrok links change
  each time you restart it — fine for a one-off class activity.)

## 4. How the game works

- **Joining:** everyone who opens the link is asked for a **display name** and
  an **access code** before they can do anything else. The default access
  code is `guess123` (set in `server.js`, or change it anytime from the
  Round Control panel — see below). Leaving the access code field blank in
  the Round Control panel disables the requirement entirely, letting anyone
  in with just a name.
- Once joined, everyone lands on the **Player** view: live chat + a guess
  box. Their name is remembered on their device for next time.
- **Scoring:** correct guesses are ranked by who answers first each round —
  1st: 10 pts, 2nd: 8, 3rd: 7, 4th: 6, 5th: 5, 6th: 4, 7th: 3, 8th: 2,
  9th and beyond: 1 pt each. Each player can only score once per round, and once you've guessed the word
  your chat is locked until the round ends (so nobody can leak the answer).
- **Round length is controlled two ways:** a time limit (Round Control's
  duration field) and a correct-guess limit (the slider — "End round after
  N correct guess(es)"). The round ends as soon as either condition is hit,
  or when the host ends it manually.
- **Hints reveal on their own fixed timer**, independent of round length —
  the "New hint every Ns" slider in Round Control (default 10s). It no
  longer scales with round duration, so a short round with a slow hint
  timer can be genuinely hard, and a long round with a fast one gives the
  word away quickly. At most all-but-one letter is ever revealed, so
  there's always something left to actually guess.
- **Rounds no longer restart automatically.** Once a round ends (by time,
  by guess count, or manually), the host has to press "Start Round" (or
  "Reroll Word") again before the next one begins.
- **⚙️ (top right)** — password-gated (`itsme` by default) — lets you set
  what *this specific screen* shows: 📺 Manager (pure display: hint, letter
  count, chat, scoreboard — good for a projector), 🔍 Word Only (the
  current word plus Start/Reroll/End round buttons — good for a helper's
  phone), or 📱 Player.
- **👁️ (top right)** — same password — opens the **Round Control** panel
  from *any* device: Start Round, set round duration, set how many correct
  guesses end a round, set/change the access code, edit the shared word
  list, and clear the chat history. This doesn't change what the screen
  normally shows; it's an overlay you open when you need it. Once unlocked,
  it stays unlocked for that browser tab's session.
- The word itself, the round timer, and scores all live on the server, not
  in the browser — so there's no way for a player to peek at the word via
  dev tools like there was in the earlier hosted-artifact version.

## 5. Customizing

- **Change the password:** edit `ADMIN_PASSWORD` near the top of `server.js`.
- **Change the default access code:** edit `accessCode` in the `config`
  object near the top of `server.js`, or just change it live from the Round
  Control panel once the server is running.
- **Change the default correct-guess limit:** edit `requiredCorrect` in the
  `config` object (default `3`), or adjust the slider live in Round Control.
- **Change the default hint interval:** edit `hintIntervalSeconds` in the
  `config` object (default `10`), or adjust the slider live in Round Control.
- **Change the port:** `PORT=8080 npm start`, or edit the `PORT` line in
  `server.js`.
- **Change the default word list:** edit `DEFAULT_WORDS` in `server.js`, or
  just use the in-app Round Control panel once it's running.

## 6. Stopping the server

`Ctrl+C` in the terminal where it's running. All game state (chat, scores,
current round) is only kept in memory and resets the next time you start it.

## 7. Deploying via GitHub + Heroku

This gets you a real `https://your-app.herokuapp.com` link that works for
anyone, anywhere, without your own machine needing to be on — Heroku runs
the server for you. **Heroku no longer has a free tier** (it was removed in
2022); the cheapest option that keeps this running is the **Eco dyno plan**
(~$5/month, shared across all your Eco apps, auto-sleeps after 30 min of no
traffic and wakes on the next visit with a few seconds' delay — fine for a
classroom activity, not ideal if you need it instantly available 24/7).

### A. Push the project to GitHub

1. Create a new repository on [github.com](https://github.com) (public or
   private, either works) — don't initialize it with a README, since this
   folder already has one.
2. From inside this project folder:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
   (The included `.gitignore` already keeps `node_modules` and any local
   `.env` file out of the repo.)

### B. Create the Heroku app and connect it to GitHub

1. Sign up / log in at [heroku.com](https://heroku.com) and create a new
   app (pick any available name — this becomes part of your URL).
2. Go to the app's **Deploy** tab → **Deployment method** → choose **GitHub**
   → connect your GitHub account if prompted → search for and connect the
   repo you just pushed.
3. Still on the Deploy tab, under **Automatic deploys**, click **Enable
   Automatic Deploys** on your `main` branch — every future `git push`
   updates the live site on its own. For the very first deploy, scroll up
   to **Manual deploy** and click **Deploy Branch** once.
4. Heroku detects this is a Node app automatically (via `package.json`) and
   uses the included `Procfile` to know how to start it — no build
   configuration needed on your end.

### C. Set your Config Vars (passwords)

Go to the **Settings** tab → **Reveal Config Vars**, and add:

| Key | Value |
|---|---|
| `ADMIN_PASSWORD` | whatever you want the host/control password to be |
| `DEFAULT_ACCESS_CODE` | whatever you want the default lobby access code to be |

If you skip this, the app falls back to the same defaults as running it
locally (`itsme` and `guess123`) — fine for testing, but change them before
sharing the link with a real class.

### D. Open it

Your app's URL is shown at the top of the Heroku dashboard (also under
**Settings** → **Domains**) — something like
`https://your-app-name.herokuapp.com`. Share that directly; no ngrok, no
local IP, no same-WiFi requirement — it just works for anyone with the
link. WebSockets work natively on Heroku, so chat, guessing, and the live
round state all function exactly as they do when run locally.

### E. Updating the game later

Any time you want to change something (edit `server.js`, tweak the default
word list, etc.), just commit and push to GitHub as normal:
```
git add .
git commit -m "Describe the change"
git push
```
Heroku picks it up automatically and redeploys within a minute or two.
