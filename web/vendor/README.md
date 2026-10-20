# Browser Dependencies

## Marked 18.0.14

- Project: https://github.com/markedjs/marked
- Token API: https://marked.js.org/using_pro#lexer
- Artifact: `https://registry.npmjs.org/marked/-/marked-18.0.14.tgz`
- Bundled file: unmodified `package/lib/marked.umd.js`.
- SHA-256: `21568877a938d2c4e7d74e27f18e60da96bb73a68809610ca39216e1efebae62`.
- License: MIT, retained in `MARKED-LICENSE.txt`.

The downloaded archive was verified against the registry's SHA-512 integrity:
`sha512-mBHK6FBHuBAlhgRe88w9F0O1AbwwXJUcQibUbC/QcdTbVGAD7aWza+xt3N6oT/jCZx3/OMeS+8rnuiHZcQ9s7A==`.

The browser loads this file from the local platform. Node does not import it and
requires no additional runtime packages. Updates are explicit: replace the pinned
artifact and license, record its version/hash, and rerun the Markdown browser
security, layout and save/preview tests. Marked tokenizes syntax; the application's
DOM renderer in `../markdown.js` independently enforces allowed elements/URLs.
