# Runbook: create the first administrator

**When:** once, on a new installation, before anyone can sign in.
**Who:** the on-site administrator together with our support engineer, at the server console (or over the support VPN).

1. Confirm the database is migrated: `pnpm db:migrate`.
2. Run, using the person's real staff ID and name:
   ```
   pnpm admin:bootstrap --staff-id <staff id> --name "<full name>" [--email <work email>]
   ```
3. The command prints a **temporary password once**. Give it to the administrator **in person**. Never send it by SMS, WhatsApp or email.
4. The administrator signs in, chooses their own password, and sets up an authenticator app on their phone. They must **write down the 8 recovery codes** and store them somewhere private.
5. The administrator then creates a **second administrator** in the app straight away. With only one admin, nobody can reset that admin's authenticator if they lose their phone (see `lost-mfa-device.md`).

The command refuses if any active administrator already exists. From then on, accounts are created in the admin screens. Every run is recorded in the audit log (`users.bootstrap_admin`).
