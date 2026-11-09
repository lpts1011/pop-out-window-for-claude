# Third-party notices

| Component | Location | License |
| --- | --- | --- |
| KaTeX 0.19.1 | `renderer/vendor/katex/` | MIT, see `renderer/vendor/katex/LICENSE` |
| Electron (development dependency, not stored in this repository) | installed by `npm install` | MIT |

## Not included in this repository

- **Claude app fonts.** When the Claude desktop app is installed, the window loads its fonts from
  `/Applications/Claude.app` at run time by `file:` URL. They are never copied into this project or redistributed.
  Without the app, system fonts are used.
- **Logos.** No logo is shipped. See "Logo" in the README to add your own image.

Claude and Anthropic are trademarks of Anthropic. This project is independent and is not affiliated with, endorsed by or
sponsored by Anthropic.
