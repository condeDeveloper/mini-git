# mini-git

Os objetos do Git, escritos do zero: blob, tree e commit, SHA-1, compressão
zlib, índice, referências e histórico. **Zero dependências.**

Os hashes são os mesmos do Git de verdade — há testes comparando com o
`git hash-object` e o `git write-tree` instalados na máquina.

```bash
$ migit iniciar
Repositório criado em /tmp/demo/.migit

$ migit add .
2 arquivo(s) preparado(s).
  + soma.js
  + src/leiame.md

$ migit commit -m "primeiro commit"
[principal (primeiro) 546ac66] primeiro commit

$ migit situacao
No ramo principal

Alterado, não preparado:
  alterado:  soma.js

Não rastreado:
  ? rascunho.txt

$ migit log
e3d390a  21/09/2026 22:20 -0300  Ana Souza
         subtrair
546ac66  21/09/2026 22:20 -0300  Ana Souza
         primeiro commit
```

E a prova de que o formato é o mesmo:

```bash
$ migit hash-object soma.js
cc0dd9933aff2116bd27803a94883fdc8b8bd603

$ git hash-object soma.js
cc0dd9933aff2116bd27803a94883fdc8b8bd603
```

## Por que existe

O Git tem fama de complicado, e a interface é mesmo. O **modelo de dados**, não:
cabe numa tarde. Depois de escrever estas quatro estruturas, comandos que antes
pareciam mágica viram consequência óbvia de como os dados estão guardados.

### 1. O nome do arquivo é o hash do conteúdo

Um objeto é gravado como `<tipo> <tamanho>\0<conteúdo>`, comprimido com zlib,
num arquivo cujo nome é o SHA-1 desses bytes. Três coisas saem de graça daí:

- **Deduplicação.** Dez commits que não mexem num arquivo apontam todos para o
  mesmo blob. Não há lógica nenhuma para isso; é o nome que coincide.
- **Integridade.** Se o conteúdo mudar debaixo do arquivo, o nome deixa de
  bater. A leitura aqui confere e recusa.
- **Comparação barata.** Saber se dois diretórios são iguais é comparar dois
  hashes de 40 caracteres, não percorrer arquivo por arquivo.

O tipo entra no cabeçalho justamente para que um blob e um commit com os mesmos
bytes não colidam.

### 2. A ordenação das trees é onde todo mundo erra

Uma tree ordena as entradas por nome — **mas compara diretórios como se
tivessem uma barra no fim**. Sem isso, `lib.js` e `lib/` saem trocados e a tree
gera um hash diferente do Git para exatamente o mesmo conteúdo.

É um erro que não aparece em teste nenhum até você comparar com o Git de
verdade. Por isso existe um teste que monta esses dois nomes lado a lado, roda
`git write-tree` e exige o mesmo hash.

### 3. Um ramo é um arquivo de texto com 40 caracteres

Não existe estrutura de ramo. `refs/heads/principal` é um arquivo com um hash
dentro. É por isso que criar um ramo é instantâneo, e por isso que apagar um
ramo não apaga commit nenhum — só some com o papelzinho que apontava para ele.

`HEAD` é outro arquivo, apontando para o primeiro (`ref: refs/heads/...`). Essa
indireção é o que faz o commit mover o ramo sozinho: o commit escreve no que o
HEAD aponta, não no HEAD.

### 4. São três estados, não dois

O commit não sai do diretório de trabalho: sai do **índice**. Essa separação é
a razão de existirem três estados, e é o que explica um arquivo aparecer ao
mesmo tempo como *preparado* e como *alterado* — o que está no índice não é
mais o que está no disco. Isso não é bug; é o modelo funcionando.

### 5. O histórico é uma corrente de hashes

O hash de um commit cobre a tree, o autor, o instante **e o hash do pai**.
Mudar um commit antigo muda o hash dele, o que muda o do filho, e assim até o
topo. Não há verificação separada de histórico: a corrente *é* a verificação.

## Comandos

```
migit iniciar                  cria um repositório .migit aqui
migit add <caminhos...>        prepara arquivos ou pastas
migit rm <caminhos...>         tira da preparação (--do-disco apaga também)
migit commit -m "mensagem"     grava o que está preparado
migit situacao                 o que mudou, nos três estados
migit log [-n N]               o histórico a partir do HEAD
migit mostrar <ref>            um commit por inteiro
migit cat-file <hash>          o conteúdo de um objeto (-t só o tipo)
migit ls-tree <hash>           as entradas de uma tree
migit hash-object <arquivo>    o hash que o arquivo teria (não grava)
migit ramos                    os ramos existentes
```

Hash abreviado funciona em todo lugar (`migit cat-file cc0dd99`). Prefixo
ambíguo é recusado em vez de escolher um — entregar o objeto errado em silêncio
seria pior do que pedir mais caracteres.

O autor sai de `MIGIT_AUTOR` e `MIGIT_EMAIL`.

A pasta se chama `.migit`, e não `.git`, de propósito: dá para versionar um
projeto com os dois ao mesmo tempo sem um pisar no outro.

## Como biblioteca

```js
import { Repositorio, hashDe } from 'mini-git';

hashDe('blob', 'oi\n'); // c09fc3cf1b3b73ae5210ed9a224034a409287dd4

const repositorio = await Repositorio.abrir(process.cwd());

await repositorio.adicionar(['src']);
await repositorio.commitar({
  mensagem: 'só o que está em src',
  autor: { nome: 'Ana', email: 'ana@exemplo' },
});

for (const commit of await repositorio.historico({ limite: 5 })) {
  console.log(commit.hash.slice(0, 7), commit.resumo);
}
```

Toda a decisão está na biblioteca; a CLI só traduz argumentos e formata. Por
isso ela é testável sem abrir processo filho.

## Estrutura

```
src/objetos.js      o formato `tipo tamanho\0conteúdo` e o SHA-1
src/deposito.js     grava e lê em .migit/objects, com zlib e hash abreviado
src/arvore.js       trees: serialização, a regra de ordenação, aninhamento
src/commit.js       commits: assinatura, fuso, pais, mensagem
src/indice.js       a área de preparação
src/repositorio.js  referências, add, commit, histórico e situação
src/cli.js          argumentos, saída e códigos de saída
```

## Rodando

```bash
npm test
```

116 testes com o `node:test` embutido. Dois deles rodam o `git` de verdade e
comparam os hashes — se o `git` não estiver instalado, eles se anunciam como
pulados em vez de passar caladamente.

Node 20 ou mais novo.

## Limites conhecidos

- **Sem `checkout`, `merge`, `diff` e `reset`.** O projeto é sobre como os
  dados são guardados, não sobre reconstruir a interface inteira.
- **Sem rede.** Nada de `clone`, `fetch` nem `push`; o protocolo do Git é outro
  projeto.
- **Índice em texto, sem cache de `mtime`.** O Git guarda `mtime`, `inode` e
  tamanho para decidir o que mudou sem reler nada. Aqui a comparação relê e
  re-hasheia cada arquivo — mais lento, e muito mais fácil de ler.
- **Sem *packfiles*.** Cada objeto é um arquivo solto; repositório grande fica
  pesado, que é exatamente o problema que os packfiles resolvem.
- **SHA-1, como o Git clássico.** Não há suporte a SHA-256.
- **`.migitignore` entende só o básico:** `*.ext`, nome de pasta e caminho
  exato. Sem `**`, sem negação com `!`.
- Só um pai por commit: sem *merge*, não há o que juntar.

## Licença

MIT.
