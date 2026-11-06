# Runbook: sign-in secrets (AUTH_HMAC_KEY, MFA_ENCRYPTION_KEY)

These two keys live in the server's environment, **not** in the database.

| Key | If lost |
|---|---|
| `MFA_ENCRYPTION_KEY` | Every authenticator becomes unreadable. Every doctor, pharmacist and admin must have their MFA reset and re-enrol. |
| `AUTH_HMAC_KEY` | All recovery codes stop working, and lockout counters reset. Nobody is locked out of their password, but recovery codes must be reissued (MFA reset). |

**Rules**
- Generate each with `openssl rand -base64 32` at installation.
- Back them up **separately from database backups** (e.g. sealed in the hospital safe, plus our encrypted secrets vault). A thief with both a database backup and the keys can attack MFA secrets.
- Restore drills (slice 9) must restore the keys from their own backup, not from the database backup.
- Never commit them, paste them in chat or tickets, or put them in screenshots.
- `MFA_ENCRYPTION_KEY_VERSION` exists so the key can be rotated later. Rotation (re-encrypting secrets under a new version) is not built yet; ask before attempting it.
