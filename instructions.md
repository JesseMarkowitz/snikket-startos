# Snikket

The domain you choose during setup is permanent: every account and message archive is stored
under it, so pick the name you will keep.

## Documentation

- [Snikket documentation](https://snikket.org/service/help/) — the upstream help pages for admins and users, from setup and invites to the apps.
- [Snikket server source](https://github.com/snikket-im/snikket-server) — the upstream server repository, including its configuration reference.

## What you get on StartOS

Snikket runs three parts on your server: the XMPP server (Prosody), the web portal where accounts
are managed, and the web proxy that serves the portal and shared files. The package exposes them
as three interfaces:

- **Web Portal** — sign in, manage users and groups, and open invite links.
- **XMPP Clients** — where the Snikket apps and other XMPP clients connect.
- **XMPP Federation** — where other XMPP servers connect so your users can talk to people
  elsewhere.

Snikket serves its own TLS certificate to apps and other servers, so the package obtains and
renews one for you. Voice and video calls can be relayed through the **Coturn** service on your
server for people who cannot connect to each other directly.

## Getting set up

1. Decide on your domain, for example `chat.example.com`. Snikket also uses
   `groups.chat.example.com` and `share.chat.example.com`, so all three names need to point at
   this server. Run **Show DNS Records** after setup to see exactly what to add at your DNS
   provider.
2. Complete the **Configure** task: enter the domain, your contact email, an optional site name,
   and whether calls should relay through Coturn. If you keep Coturn selected, install and start
   the Coturn service too, and give it a public domain of its own (for example
   `turn.chat.example.com`) on its TURN/STUN interface.
3. Add your domain to the **Web Portal** interface, then enable it on the **XMPP Clients** and
   **XMPP Federation** interfaces as well. Add `groups.` and `share.` under the same domain the
   same way. All three names must be attached before a certificate can be issued for them.
4. Complete the **Configure Certificate** task. Choose one of:
   - **Let's Encrypt (DNS-01)** for a publicly trusted certificate. You need an API token from
     the DNS provider that hosts your domain; the lego page linked in the form lists the exact
     variable names to paste.
   - **StartOS certificate authority** for a server that only serves devices on your network.
     Each device must trust this server's root certificate.
   - **Paste a certificate** if you obtained one elsewhere. You will paste a renewed one
     yourself before it expires.
5. Start Snikket. The **Certificate** health check reports when a certificate is in place; the
   **XMPP Server** and **Web Interface** checks go green once it is. If it reports a problem,
   fix the cause and it tries again within ten minutes.
6. Run **Create Invite** with **Administrator** switched on, and open the link it returns on the
   device you will use. Registering from that link creates your admin account.
7. Install the Snikket app on your phone, or use any XMPP client, and sign in with the account
   you just created.

## Using Snikket

### Web Portal

Open the Web Portal interface in a browser and sign in. On your own network, use the address
under your domain rather than the `.local` one: Snikket only answers requests for its own
domain, so the domain must resolve to this server from the device you are using. Admins see a
management area for users, groups, and invitations; every user can manage their own account and
devices there.

### Actions

- **Create Invite** — a single-use link (and QR code) that lets someone register on your
  server. Turn on **Administrator** to make the new account an admin.
- **Reset Password** — a single-use link that lets a user set a new password. Give it to the
  user directly.
- **Show DNS Records** — the address records your domain needs, and the SRV records to add if
  your server was given non-standard XMPP ports.
- **Configure** — change the contact email, site name, or the call relay choice. The domain
  cannot be changed.
- **Configure Certificate** — switch certificate sources or paste a renewed certificate.
- **Configure SMTP** — let Snikket send invitation and password-reset emails. Without SMTP,
  share the links by hand.

### Calls

Voice and video calls work between people who can reach each other directly. With Coturn
installed, started, and given a public domain, calls also connect through the relay for people
behind restrictive networks.

## Limitations

- The domain is permanent. To move to a new domain, uninstall Snikket and set it up again;
  users would need new accounts.
- With the StartOS certificate authority, other XMPP servers will not federate with yours, and
  every device that connects must trust this server's root certificate.
