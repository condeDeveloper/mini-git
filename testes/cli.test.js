import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { autorDoAmbiente, formatarArvore, formatarData, lerArgumentos, principal } from '../src/cli.js';
import { MODOS, serializarArvore } from '../src/arvore.js';
import { hashDe } from '../src/objetos.js';

const temporarios = [];

/** Pasta temporária vazia. */
async function pasta() {
  const caminho = await mkdtemp(join(tmpdir(), 'migit-cli-'));

  temporarios.push(caminho);

  return caminho;
}

/** Roda um comando e devolve o código e a saída inteira. */
async function rodar(argumentos, diretorio) {
  const linhas = [];
  const codigo = await principal(argumentos, (linha) => linhas.push(String(linha)), diretorio);

  return { codigo, saida: linhas.join('\n') };
}

after(async () => {
  for (const caminho of temporarios) await rm(caminho, { recursive: true, force: true });
});

describe('argumentos', () => {
  it('lê o comando e os caminhos', () => {
    const opcoes = lerArgumentos(['add', 'src', 'leiame.md']);

    assert.equal(opcoes.comando, 'add');
    assert.deepEqual(opcoes.caminhos, ['src', 'leiame.md']);
  });

  it('lê mensagem, limite e bandeiras', () => {
    const opcoes = lerArgumentos(['commit', '-m', 'oi', '-n', '3', '-t', '--do-disco']);

    assert.equal(opcoes.mensagem, 'oi');
    assert.equal(opcoes.limite, 3);
    assert.equal(opcoes.soTipo, true);
    assert.equal(opcoes.doDisco, true);
  });

  it('recusa -m sem texto e -n inválido', () => {
    assert.throws(() => lerArgumentos(['commit', '-m']), /Faltou a mensagem/);
    assert.throws(() => lerArgumentos(['log', '-n', 'abc']), /inteiro positivo/);
    assert.throws(() => lerArgumentos(['log', '-n', '0']), /inteiro positivo/);
  });

  it('recusa opção desconhecida', () => {
    assert.throws(() => lerArgumentos(['log', '--inventada']), /desconhecida/);
  });

  it('o autor vem do ambiente, com padrão', () => {
    assert.deepEqual(autorDoAmbiente({ MIGIT_AUTOR: 'Ana', MIGIT_EMAIL: 'a@b' }), { nome: 'Ana', email: 'a@b' });
    assert.equal(autorDoAmbiente({}).nome, 'mini-git');
  });
});

describe('formatação', () => {
  it('a data é mostrada no fuso registrado no commit', () => {
    // 1700000000 é 14/11/2023 22:13 UTC; em -0300 é 19:13 do mesmo dia.
    assert.equal(formatarData({ segundos: 1_700_000_000, fuso: '-0300' }), '14/11/2023 19:13 -0300');
    assert.equal(formatarData({ segundos: 1_700_000_000, fuso: '+0000' }), '14/11/2023 22:13 +0000');
  });

  it('a tree sai com modo, tipo, hash e nome', () => {
    const bytes = serializarArvore([
      { nome: 'a.js', modo: MODOS.arquivo, hash: hashDe('blob', 'a') },
      { nome: 'src', modo: MODOS.pasta, hash: hashDe('tree', '') },
    ]);

    const texto = formatarArvore(bytes);

    assert.match(texto, /100644 blob [0-9a-f]{40} {2}a\.js/);
    assert.match(texto, /040000 tree [0-9a-f]{40} {2}src/);
  });
});

describe('comandos', () => {
  it('a ajuda sai com zero', async () => {
    const { codigo, saida } = await rodar(['ajuda'], await pasta());

    assert.equal(codigo, 0);
    assert.match(saida, /mini-git/);
  });

  it('comando desconhecido sai com 2 e mostra a ajuda', async () => {
    const { codigo, saida } = await rodar(['voar'], await pasta());

    assert.equal(codigo, 2);
    assert.match(saida, /Comando desconhecido/);
  });

  it('opção inválida sai com 2', async () => {
    assert.equal((await rodar(['log', '--inventada'], await pasta())).codigo, 2);
  });

  it('um ciclo inteiro: iniciar, add, commit, log', async () => {
    const dir = await pasta();

    await writeFile(join(dir, 'a.txt'), 'primeiro conteúdo\n');

    assert.equal((await rodar(['iniciar'], dir)).codigo, 0);
    assert.match((await rodar(['iniciar'], dir)).saida, /Já existe/);

    const adicionado = await rodar(['add', '.'], dir);

    assert.equal(adicionado.codigo, 0);
    assert.match(adicionado.saida, /1 arquivo\(s\) preparado\(s\)/);

    const commitado = await rodar(['commit', '-m', 'início do projeto'], dir);

    assert.equal(commitado.codigo, 0);
    assert.match(commitado.saida, /\[principal \(primeiro\) [0-9a-f]{7}\] início do projeto/);

    const log = await rodar(['log'], dir);

    assert.equal(log.codigo, 0);
    assert.match(log.saida, /início do projeto/);
  });

  it('fora de um repositório sai com 1', async () => {
    const { codigo, saida } = await rodar(['log'], await pasta());

    assert.equal(codigo, 1);
    assert.match(saida, /Nenhum repositório/);
  });

  it('commit sem -m sai com 1', async () => {
    const dir = await pasta();

    await rodar(['iniciar'], dir);

    const { codigo, saida } = await rodar(['commit'], dir);

    assert.equal(codigo, 1);
    assert.match(saida, /precisa de mensagem/);
  });

  it('log sem commit avisa em vez de quebrar', async () => {
    const dir = await pasta();

    await rodar(['iniciar'], dir);

    assert.match((await rodar(['log'], dir)).saida, /Nenhum commit ainda/);
  });

  it('a situação mostra os três estados', async () => {
    const dir = await pasta();

    await rodar(['iniciar'], dir);
    await writeFile(join(dir, 'preparado.txt'), 'x');
    await rodar(['add', '.'], dir);
    await writeFile(join(dir, 'solto.txt'), 'y');

    const { saida } = await rodar(['situacao'], dir);

    assert.match(saida, /No ramo principal/);
    assert.match(saida, /novo: +preparado\.txt/);
    assert.match(saida, /\? solto\.txt/);
  });

  it('a situação limpa diz que não há nada a fazer', async () => {
    const dir = await pasta();

    await rodar(['iniciar'], dir);

    assert.match((await rodar(['status'], dir)).saida, /trabalho limpo/);
  });

  it('hash-object não precisa de repositório e não grava nada', async () => {
    const dir = await pasta();
    const arquivo = join(dir, 'a.txt');

    await writeFile(arquivo, 'oi\n');

    const { codigo, saida } = await rodar(['hash-object', arquivo], dir);

    assert.equal(codigo, 0);
    assert.equal(saida.trim(), 'c09fc3cf1b3b73ae5210ed9a224034a409287dd4');
  });

  it('cat-file aceita hash abreviado e -t', async () => {
    const dir = await pasta();

    await writeFile(join(dir, 'a.txt'), 'conteúdo\n');
    await rodar(['iniciar'], dir);
    await rodar(['add', '.'], dir);

    const hash = hashDe('blob', 'conteúdo\n');

    assert.equal((await rodar(['cat-file', hash.slice(0, 7)], dir)).saida, 'conteúdo');
    assert.equal((await rodar(['cat-file', '-t', hash.slice(0, 7)], dir)).saida, 'blob');
  });

  it('ls-tree lista a tree do commit', async () => {
    const dir = await pasta();

    await writeFile(join(dir, 'a.txt'), 'a');
    await rodar(['iniciar'], dir);
    await rodar(['add', '.'], dir);
    await rodar(['commit', '-m', 'x'], dir);

    const mostrado = await rodar(['mostrar'], dir);
    const arvore = /tree {3}([0-9a-f]{40})/.exec(mostrado.saida)[1];

    assert.match((await rodar(['ls-tree', arvore], dir)).saida, /blob [0-9a-f]{40} {2}a\.txt/);
  });

  it('ls-tree num blob reclama', async () => {
    const dir = await pasta();

    await writeFile(join(dir, 'a.txt'), 'a');
    await rodar(['iniciar'], dir);
    await rodar(['add', '.'], dir);

    const { codigo, saida } = await rodar(['ls-tree', hashDe('blob', 'a')], dir);

    assert.equal(codigo, 1);
    assert.match(saida, /não uma tree/);
  });

  it('ramos marca o ramo atual', async () => {
    const dir = await pasta();

    await writeFile(join(dir, 'a.txt'), 'a');
    await rodar(['iniciar'], dir);
    await rodar(['add', '.'], dir);
    await rodar(['commit', '-m', 'x'], dir);

    assert.match((await rodar(['ramos'], dir)).saida, /\* principal/);
  });

  it('rm tira do índice', async () => {
    const dir = await pasta();

    await writeFile(join(dir, 'a.txt'), 'a');
    await rodar(['iniciar'], dir);
    await rodar(['add', '.'], dir);

    assert.match((await rodar(['rm', 'a.txt'], dir)).saida, /1 removido/);
    assert.match((await rodar(['rm', 'a.txt'], dir)).saida, /Nada no índice/);
  });

  it('rm e cat-file sem argumento reclamam', async () => {
    const dir = await pasta();

    await rodar(['iniciar'], dir);

    assert.equal((await rodar(['rm'], dir)).codigo, 1);
    assert.equal((await rodar(['cat-file'], dir)).codigo, 1);
    assert.equal((await rodar(['hash-object'], dir)).codigo, 1);
  });
});
