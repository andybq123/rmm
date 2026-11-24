# SDK do painel — vendorizado como código-fonte (texto)

Esta pasta é o pacote `@hatch/space-sdk` **extraído como arquivos-fonte de
texto** (JavaScript, TypeScript `.d.ts`, JSON e CSS — tudo UTF-8). Ele NÃO é
um arquivo binário: nenhum `.tgz`, `.wasm`, fonte ou outro binário faz parte
desta pasta nem é necessário para o build.

Por que vendorizado? O `@hatch/space-sdk` não é publicado no npm, e o painel
(`server/src/actions.ts`, `client/src/*`, `standalone/server.ts`) é escrito
contra ele. Para o build na VPS ser autossuficiente a partir de um clone
limpo do Git — só com arquivos de texto — o SDK vai junto, como fonte.

Como é usado: o `Dockerfile` aponta o `package.json` **dentro da imagem**
para `file:./vendor/space-sdk` antes do `bun install`. Fora do Docker, o
`package.json` da raiz continua apontando para a cópia do ambiente de
desenvolvimento — o restante do projeto não muda.

Única omissão em relação ao pacote original: a pasta
`dist/pdfjs-assets/` (binários `.wasm`/fontes/cmaps do visualizador de PDF
opcional `@hatch/space-sdk/pdf`). Este painel não usa visualização de PDF —
o build do cliente só copia esses assets quando o app importa esse módulo
(ver `dist/build.js`: a cópia é condicional) — então eles foram deixados de
fora justamente para o repositório não carregar nenhum binário. Se um dia o
painel passar a exibir PDFs no deploy standalone, esses assets precisam
voltar por outro canal.
