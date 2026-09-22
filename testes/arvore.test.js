import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { MODOS, chaveDeOrdem, ehPasta, gravarArvore, lerArvore, lerArvoreInteira, ordenar, serializarArvore } from '../src/arvore.js';
import { Deposito } from '../src/deposito.js';
import { ErroDeObjeto, hashDe } from '../src/objetos.js';

const temporarios = [];

async function pastaTemporaria() {
  const caminho = await mkdtemp(join(tmpdir(), 'migit-arvore-'));

  temporarios.push(caminho);

  return caminho;
}

after(async () => {
  for (const caminho of temporarios) await rm(caminho, { recursive: true, force: true });
});

function gitDisponivel() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HASH_A = hashDe('blob', 'a');
const HASH_B = hashDe('blob', 'b');

describe('ordem das entradas', () => {
  it('diretório compara com uma barra no fim', () => {
    assert.equal(chaveDeOrdem({ nome: 'lib', modo: MODOS.pasta }), 'lib/');
    assert.equal(chaveDeOrdem({ nome: 'lib.js', modo: MODOS.arquivo }), 'lib.js');
  });

  it('`lib.js` vem antes de `lib/`', () => {
    // Sem a barra, `lib` < `lib.js` e a tree sai com um hash que o git não
    // reconhece como igual ao dela.
    const ordenadas = ordenar([
      { nome: 'lib', modo: MODOS.pasta, hash: HASH_A },
      { nome: 'lib.js', modo: MODOS.arquivo, hash: HASH_B },
    ]);

    assert.deepEqual(ordenadas.map((e) => e.nome), ['lib.js', 'lib']);
  });

  it('a ordem não depende de como as entradas chegaram', () => {
    const entradas = [
      { nome: 'z.js', modo: MODOS.arquivo, hash: HASH_A },
      { nome: 'a.js', modo: MODOS.arquivo, hash: HASH_B },
    ];

    assert.deepEqual(serializarArvore(entradas), serializarArvore([...entradas].reverse()));
  });

  it('reconhece os dois jeitos de escrever o modo de pasta', () => {
    assert.equal(ehPasta('40000'), true);
    assert.equal(ehPasta('040000'), true);
    assert.equal(ehPasta(MODOS.arquivo), false);
  });
});

describe('serialização da tree', () => {
  it('vai e volta', () => {
    const entradas = [
      { nome: 'a.js', modo: MODOS.arquivo, hash: HASH_A },
      { nome: 'src', modo: MODOS.pasta, hash: HASH_B },
    ];

    assert.deepEqual(lerArvore(serializarArvore(entradas)), ordenar(entradas));
  });

  it('o hash ocupa 20 bytes, não os 40 do texto', () => {
    const bytes = serializarArvore([{ nome: 'a', modo: MODOS.arquivo, hash: HASH_A }]);

    assert.equal(bytes.length, `${MODOS.arquivo} a\0`.length + 20);
  });

  it('nome com barra é recusado', () => {
    // Uma tree descreve um nível só; `src/a.js` viraria duas trees.
    assert.throws(() => serializarArvore([{ nome: 'src/a.js', modo: MODOS.arquivo, hash: HASH_A }]), /Nome inválido/);
  });

  it('nome repetido na mesma tree é recusado', () => {
    assert.throws(
      () =>
        serializarArvore([
          { nome: 'a', modo: MODOS.arquivo, hash: HASH_A },
          { nome: 'a', modo: MODOS.arquivo, hash: HASH_B },
        ]),
      /repetido/,
    );
  });

  it('tree truncada é recusada', () => {
    const inteira = serializarArvore([{ nome: 'a', modo: MODOS.arquivo, hash: HASH_A }]);

    assert.throws(() => lerArvore(inteira.subarray(0, inteira.length - 5)), ErroDeObjeto);
  });

  it('tree vazia é válida', () => {
    assert.deepEqual(lerArvore(serializarArvore([])), []);
  });
});

describe('gravarArvore', () => {
  it('dobra caminhos planos em trees aninhadas', async () => {
    const deposito = new Deposito(await pastaTemporaria());

    const raiz = await gravarArvore(deposito, [
      { caminho: 'leiame.md', hash: HASH_A, modo: MODOS.arquivo },
      { caminho: 'src/util/soma.js', hash: HASH_B, modo: MODOS.arquivo },
    ]);

    const plano = await lerArvoreInteira(deposito, raiz);

    assert.deepEqual(
      plano.map((a) => a.caminho).sort(),
      ['leiame.md', 'src/util/soma.js'],
    );
  });

  it('o mesmo conteúdo dá a mesma tree', async () => {
    const deposito = new Deposito(await pastaTemporaria());
    const arquivos = [{ caminho: 'a/b.js', hash: HASH_A, modo: MODOS.arquivo }];

    assert.equal(await gravarArvore(deposito, arquivos), await gravarArvore(deposito, arquivos));
  });

  it('dois arquivos iguais compartilham o blob', async () => {
    // A deduplicação não é um recurso à parte: sai de graça de o nome ser o
    // hash do conteúdo.
    const deposito = new Deposito(await pastaTemporaria());

    await deposito.escrever('blob', 'igual');
    await deposito.escrever('blob', 'igual');

    assert.equal((await deposito.todos()).length, 1);
  });

  it('ler uma tree que na verdade é blob reclama', async () => {
    const deposito = new Deposito(await pastaTemporaria());
    const hash = await deposito.escrever('blob', 'nao sou tree');

    await assert.rejects(() => lerArvoreInteira(deposito, hash), /Esperava uma tree/);
  });
});

describe('contra o git de verdade', () => {
  it('a tree raiz tem o mesmo hash que o `git write-tree`', { skip: gitDisponivel() ? false : 'git não instalado' }, async () => {
    // O caso que mais pega: `lib.js` e `lib/` no mesmo nível. Se a ordenação
    // estiver errada, o hash diverge aqui e em nenhum outro lugar.
    const pasta = await pastaTemporaria();
    const arquivos = [
      { caminho: 'lib.js', conteudo: 'a\n' },
      { caminho: 'lib/interno.js', conteudo: 'b\n' },
      { caminho: 'leiame.md', conteudo: 'c\n' },
    ];

    for (const arquivo of arquivos) {
      await mkdir(join(pasta, ...arquivo.caminho.split('/').slice(0, -1)), { recursive: true });
      await writeFile(join(pasta, ...arquivo.caminho.split('/')), arquivo.conteudo);
    }

    const git = (...args) => execFileSync('git', args, { cwd: pasta, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

    git('init', '-q');
    git('add', '.');

    const doGit = git('write-tree');

    const deposito = new Deposito(join(pasta, '.migit'));
    const nossa = await gravarArvore(
      deposito,
      arquivos.map((a) => ({ caminho: a.caminho, hash: hashDe('blob', a.conteudo), modo: MODOS.arquivo })),
    );

    assert.equal(nossa, doGit);
  });
});
