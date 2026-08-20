# What this fork adds

Tracks [ZimengXiong/ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) and carries four changes that
are also open upstream as separate pull requests. `main` here is the running,
self-hostable combination of all of them.

| Upstream PR | What it does |
| --- | --- |
| [#247](https://github.com/ZimengXiong/ExcaliDash/pull/247) | Version history no longer fills the disk: snapshots are Brotli-compressed and freed pages are returned |
| [#248](https://github.com/ZimengXiong/ExcaliDash/pull/248) | Password reset links are actually delivered, by SMTP or Resend |
| [#249](https://github.com/ZimengXiong/ExcaliDash/pull/249) | Reveal toggle on password fields, live match feedback, opt-in longer sessions |
| [#250](https://github.com/ZimengXiong/ExcaliDash/pull/250) | The E2E job stops locking itself out with HTTP 429 |
| not upstream yet | Admin-created accounts can be invited by email instead of handing a password over by chat |
| not upstream yet | Agents authenticate with an API key: the websocket accepts them too, and an admin tab lists and revokes them |

## Hosting it

```bash
git clone https://github.com/davifernan/ExcaliDash.git
cd ExcaliDash
cp backend/.env.example .env      # set JWT_SECRET and CSRF_SECRET
docker compose up -d --build
```

The frontend is then on `http://localhost:6767`. Every setting below is optional and
read from `.env`; the defaults keep the upstream behaviour.

### Sending password reset emails

Without a transport the reset endpoint answers 503 instead of claiming a mail was
sent, and the reset page shows the admin-recovery instructions instead of a form.

```bash
ENABLE_PASSWORD_RESET=true
MAIL_FROM="ExcaliDash <noreply@your-domain.com>"

# either an SMTP server you already run
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=

# or Resend
RESEND_API_KEY=re_...
```

`MAIL_TRANSPORT` (`smtp`, `resend` or `none`) forces one explicitly; leaving it unset
follows whatever is configured. With Resend, turn **off** click tracking for the
sending domain — it rewrites links, which is the last thing a reset link needs.

### Version history

Both default to on and only need setting to switch them off:

```bash
ENABLE_SNAPSHOT_COMPRESSION=true   # store snapshots compressed (~90 % smaller)
ENABLE_SNAPSHOT_VACUUM=true        # return freed database pages to the filesystem
```

### Agents

An agent is an API key belonging to a user, not an account of its own, so anything it
creates already belongs to that user and nothing has to be shared afterwards. Users create
keys under **Profile → API keys**; admins see and revoke every key under **Admin → Agents**.

Beyond the default scopes, a key can be granted `drawings:history` and `drawings:share`.
Both are opt-in: an ordinary key can neither read a drawing's history nor hand it to another
account.

### Session length

```bash
JWT_REFRESH_EXPIRES_IN_REMEMBERED=30d   # used only when "stay signed in" is ticked
```
