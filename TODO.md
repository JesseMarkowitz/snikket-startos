# TODO

- [ ] Issue a real Let's Encrypt certificate through the DNS-01 source on a box with a DNS API
      token. The code path is built and type-checked but has never issued; only the StartOS-CA
      source has been exercised end to end.
- [ ] Verify federation (inbound 5269, s2s to another server) once the box has working public
      inbound and its domain attached. Reasoned about from the VPS validation, not driven here.
- [ ] Backup and restore round-trip on the box (needs the target's password).
- [ ] Exercise real mail sending (invite by email) against an SMTP server; only msmtp's config
      load as the `prosody` user has been verified.
- [ ] First commit and the GitHub repo `JesseMarkowitz/snikket-startos` (`packageRepo` already
      names it). The package is installed and running on the test server, uncommitted.
