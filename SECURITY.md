# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Report a
vulnerability** button on the Security tab, or by email to the address in
`package.json`. Do not open a public issue for a vulnerability.

Please include what you found, how to reproduce it, and what an attacker could
do with it. Expect an acknowledgement within a week.

## What Twinfabric is, in security terms

Twinfabric runs **entirely in the browser**. There is no server, no account, no
telemetry and no network traffic except fetching Three.js from a CDN when you
run without a build step. Projects are stored in the browser's IndexedDB for
the origin the app is served from, and exported as files you control.

That keeps the attack surface small, but it does **not** make the data
harmless.

## The data is more sensitive than it looks

A completed Twinfabric project is a detailed description of a physical
building and its systems:

- room-by-room floor plans, dimensions and circulation
- the location of every camera, display, server and rack
- network topology, IP addresses, hostnames, MAC addresses and VLANs
- power distribution: boards, circuits, UPS and what depends on them
- cable routes, risers, ceiling voids and wall penetrations

That is a useful document for the people who maintain the building and a
useful document for anyone planning against it. Treat an export the way you
would treat as-built drawings and a network diagram stapled together.

**Practical guidance**

- Do not commit real project exports to a public repository.
- Do not attach a real export to a public issue. Reproduce the problem with a
  cut-down or renamed project instead, or send it privately.
- Strip IP addresses, hostnames and MAC addresses before sharing a file
  outside the team that maintains the building.
- Anyone who can open the URL the app is served from can read the projects
  stored there. Do not host it on a shared origin with the project data
  already in IndexedDB and assume the data is private.
- Browser storage is not a backup. Export regularly and keep the exports
  wherever your organisation keeps as-built documentation.

## Supported versions

Twinfabric is pre-1.0. Security fixes land on `main` and in the next release;
older versions are not patched. Please report against `main` where you can.

## Scope

In scope: anything that lets a page or file read or modify another origin's
data, execute code from an imported project, or exfiltrate a stored project.

Out of scope: the fact that a project stored in the browser is readable by
someone with access to that browser profile; issues that require a
already-compromised machine; and CDN availability.

## Dependencies

The runtime dependency is Three.js. Development dependencies are Vite, Vitest,
ESLint and TypeScript. Dependency alerts are handled through GitHub's
Dependabot on `main`.
