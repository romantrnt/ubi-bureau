# Third-party notices

Ubi Bureau is an independent derivative. A project-level license does not replace dependency licenses or grant trademark rights.

## Original application

- **whatsmyagentdoing v0.8.1** by cheoyu / Charonyuu.
- Source: https://github.com/Charonyuu/whatsmyagentdoing
- Base revision: `c69bf2bc98cf96a63d146070e9bbc83b507bf0bf`.
- License: MIT. The original copyright and complete license are preserved in [LICENSE](LICENSE).

## Office assets

Kenney's **Furniture Kit** and **Mini Characters** are distributed under CC0. Their supplied notices remain at:

- [assets/kenney/LICENSE-furniture-kit.txt](assets/kenney/LICENSE-furniture-kit.txt)
- [assets/kenney/LICENSE-mini-characters.txt](assets/kenney/LICENSE-mini-characters.txt)

Source: https://kenney.nl. Optional downloaded scene packs retain the credits declared in their manifests and the repository's scene catalog.

## JavaScript and build dependencies

The 3D bundle includes **Three.js**, MIT licensed: https://github.com/mrdoob/three.js. Its complete MIT notice is retained in [THIRD-PARTY-LICENSES/three.txt](THIRD-PARTY-LICENSES/three.txt), alongside the generated bundle notices. The lockfile records the versions used for the build.

**esbuild** (MIT) and **Playwright** (Apache-2.0) are development tools, not permission to redistribute their separate browser runtimes without the corresponding notices. The host-runtime AppImage does not bundle Chromium.

## Interface font

**Adwaita Sans** (font version 4.001), based on Inter, is distributed under the SIL Open Font License 1.1. The unmodified variable regular font and complete supplied notice are bundled at [assets/fonts/AdwaitaSans-Regular.ttf](assets/fonts/AdwaitaSans-Regular.ttf) and [assets/fonts/Adwaita-LICENSE.txt](assets/fonts/Adwaita-LICENSE.txt). Source: https://gitlab.gnome.org/GNOME/adwaita-fonts. Obtained from the installed distribution package; no font service is contacted.

## Retained pixel font

**Pixelify Sans**, obtained from the Google Fonts repository, uses the SIL Open Font License 1.1. The font and complete supplied notice are bundled at [assets/fonts/PixelifySans.ttf](assets/fonts/PixelifySans.ttf) and [assets/fonts/OFL.txt](assets/fonts/OFL.txt).

Source: https://github.com/google/fonts/tree/main/ofl/pixelifysans.

## Provider icons

Provider names and marks identify the source of a session. They belong to their respective owners; Ubi Bureau is not endorsed by those providers. See [the icon provenance](assets/agents/README.md). The original application code license does not grant trademark rights.

Kimi, DeepSeek Harness and xAI artwork inherited through **Magpie** retains its MIT notice in [assets/agents/MAGPIE-LICENSE](assets/agents/MAGPIE-LICENSE). Source: https://github.com/yetone/magpie.

The Ubi Bureau logo is supplied for this project by its owner. The procedural Dot mascot is a project-specific interpretation, not evidence of an official affiliation or a live service connection.

## AppImage and host libraries

The packaged Type 2 runtime comes from https://github.com/AppImage/type2-runtime. Its MIT license and the supplied component references are retained in [packaging/runtime-LICENSE](packaging/runtime-LICENSE). The runtime statically links musl libc, libfuse, squashfuse, libzstd and zlib; these components retain their separate terms, including libfuse's LGPL terms. The runtime notice links to their upstream license texts. Check the packaging script for the pinned input digest and source.

The AppImage bundles the **official Node.js 24.22.3 Linux x64 distribution** from [nodejs.org](https://nodejs.org/dist/v24.22.3/). Its complete supplied `LICENSE`, including bundled-component notices, is copied into `THIRD-PARTY-LICENSES/node.txt` inside the AppImage. The packaging script pins the download digest.

Python, PyGObject, GTK4 and WebKitGTK are **not** bundled. They are supplied by the user's distribution and retain their own licenses. Ubi Bureau's MIT source license does not relicense these components or the libraries statically linked into the AppImage runtime.
