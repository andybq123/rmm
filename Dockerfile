# RMM Console — imagem do serviço "app" (painel + API) para a VPS.
# O docker-compose sobe ESTA imagem junto com o Caddy; sem ela o proxy
# não tem para quem encaminhar e o navegador recebe 502.
#
# O SDK @hatch/space-sdk não é público no npm: ele vai vendorizado como
# CÓDIGO-FONTE DE TEXTO em vendor/space-sdk/ (JS/d.ts/JSON/CSS, tudo
# UTF-8 — nenhum .tgz nem outro binário) e o package.json é apontado
# para essa pasta só aqui dentro da imagem (o restante do projeto
# não muda). Um clone limpo do Git, só com arquivos de texto, basta:
#      docker compose up -d --build
FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN sed -i 's#"@hatch/space-sdk": "file:[^"]*"#"@hatch/space-sdk": "file:./vendor/space-sdk"#' package.json \
 && rm -f bun.lock \
 && bun install \
 && HATCH_SPACES_BUILD_DRIVER=1 bun run build:client

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3000 \
    RMM_DB_PATH=/app/data/app.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["bun", "standalone/server.ts"]
