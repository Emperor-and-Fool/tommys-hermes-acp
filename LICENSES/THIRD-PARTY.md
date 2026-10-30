# Third-party components shipped with this extension

Everything below is bundled inside the VSIX. This file exists because the package a
recipient downloads must carry its own attributions — `packaging/copyright` in the
repository says the same thing, but it is not shipped.

| component | where it lives | version | licence |
|---|---|---|---|
| `@agentclientprotocol/sdk` | `node_modules/@agentclientprotocol/sdk` | 0.28.1 | Apache-2.0 |
| `zod` | `node_modules/zod` | 4.4.3 | MIT |
| marked | `media/vendor/marked.min.js` | bundled | MIT |
| DOMPurify | `media/vendor/purify.min.js` | bundled | Apache-2.0 |
| highlight.js | `media/vendor/highlight.min.js` | bundled | BSD-3-Clause |
| highlight.js themes | `media/vendor/github-dark.min.css`, `github-light.min.css` | bundled | BSD-3-Clause |

`marked.min.js`, `purify.min.js` and `highlight.min.js` carry their own licence headers
in the file. The npm packages ship their full `LICENSE` files inside their directories.
The two highlight.js theme stylesheets carry no header, so the licence text follows here.

---

## BSD 3-Clause License (highlight.js, including the theme stylesheets)

Copyright (c) 2006, Ivan Sagalaev
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of
   conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list
   of conditions and the following disclaimer in the documentation and/or other materials
   provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors may be
   used to endorse or promote products derived from this software without specific prior
   written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## Not software

The whale artwork under `media/` is *designed by Magnific from Flaticon*, used under the
Flaticon Free License, and is **not** covered by the GPL that covers the rest of this
project. See `NOTICE` and <https://media.flaticon.com/license/license.pdf>.

`@agentclientprotocol/sdk` and DOMPurify are Apache-2.0: the full licence text is in each
package's own `LICENSE` file inside the VSIX.
