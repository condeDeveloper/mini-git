import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Repositorio, ErroDeRepositorio, ignorar, RAMO_PADRAO } from '../src/repositorio.js';
import { lerArvoreInteira } from '../src/arvore.js';
import { hashDe } from '../src/objetos.js';

const AUTOR = { nome: 'Ana', email: 'ana@exemplo' };
const temporarios = [];

/** Um repositório novo numa pasta temporária. */
async function repositorioNovo() {
  const pasta = await mkdtemp(join(tmpdir(), 'migit-repo-'));

  temporarios.push(pasta);

  const { repositorio } = await Repositorio.iniciar(pasta);

  return repositorio;
}

/** Escreve um arquivo no diretório de trabalho, criando as pastas do caminho. */
async function escrever(repositorio, caminho, conteudo) {
  const partes = caminho.split('/');

  if (partes.length > 1) await mkdir(join(repositorio.trabalho, ...partes.slice(0, -1)), { recursive: true });

  await writeFile(join(repositorio.trabalho, ...partes), conteudo, 'utf8');
}

after(async () => {
  for (const caminho of temporarios) await rm(caminho, { recursive: true, force: true });
});

describe('iniciar e abrir', () => {
  it('cria a estrutura e o HEAD apontando para o ramo padrão', async () => {
    const repositorio = await repositorioNovo();

    assert.ok(existsSync(join(repositorio.controle, 'objects')));
    assert.ok(existsSync(join(repositorio.controle, 'refs', 'heads')));
    assert.equal(
      (await readFile(join(repositorio.controle, 'HEAD'), 'utf8')).trim(),
      `ref: refs/heads/${RAMO_PADRAO}`,
    );
  });

  it('iniciar duas vezes não apaga nada', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['a.txt']);

    const segunda = await Repositorio.iniciar(repositorio.trabalho);

    assert.equal(segunda.criado, false);
    assert.equal((await repositorio.indice.carregar()).quantidade, 1);
  });

  it('o ramo ainda não existe antes do primeiro commit', async () => {
    const cabeca = await (await repositorioNovo()).cabeca();

    assert.equal(cabeca.ramo, RAMO_PADRAO);
    assert.equal(cabeca.hash, null);
  });

  it('abre de dentro de uma subpasta', async () => {
    // É o que deixa rodar `migit log` de qualquer lugar do projeto.
    const repositorio = await repositorioNovo();

    await mkdir(join(repositorio.trabalho, 'src', 'util'), { recursive: true });

    const aberto = await Repositorio.abrir(join(repositorio.trabalho, 'src', 'util'));

    assert.equal(aberto.trabalho, repositorio.trabalho);
  });

  it('fora de um repositório reclama', async () => {
    const solta = await mkdtemp(join(tmpdir(), 'migit-solta-'));

    temporarios.push(solta);

    await assert.rejects(() => Repositorio.abrir(solta), ErroDeRepositorio);
  });
});

describe('exclusões', () => {
  it('a própria pasta de controle nunca entra', () => {
    assert.equal(ignorar('.migit/objects/ab/cd'), true);
    assert.equal(ignorar('node_modules/pacote/index.js'), true);
    assert.equal(ignorar('src/a.js'), false);
  });

  it('padrão por extensão, por pasta e por caminho', () => {
    assert.equal(ignorar('registro.log', ['*.log']), true);
    assert.equal(ignorar('src/saida/a.js', ['saida/']), true);
    assert.equal(ignorar('build/x/y.js', ['build']), true);
    assert.equal(ignorar('doc/notas.md', ['doc/notas.md']), true);
    assert.equal(ignorar('doc/outras.md', ['doc/notas.md']), false);
  });

  it('o .migitignore é respeitado na listagem', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, '.migitignore', '*.log\ntemporario/\n# comentário\n');
    await escrever(repositorio, 'a.js', 'a');
    await escrever(repositorio, 'saida.log', 'ruído');
    await escrever(repositorio, 'temporario/b.js', 'b');

    assert.deepEqual(await repositorio.arquivosDeTrabalho(), ['.migitignore', 'a.js']);
  });
});

describe('add', () => {
  it('prepara os arquivos e grava os blobs', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'conteúdo a');

    const preparados = await repositorio.adicionar(['.']);

    assert.deepEqual(preparados, ['a.txt']);
    assert.ok(repositorio.deposito.existe(hashDe('blob', 'conteúdo a')));
  });

  it('aceita um arquivo só', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await escrever(repositorio, 'b.txt', 'b');

    assert.deepEqual(await repositorio.adicionar(['a.txt']), ['a.txt']);
  });

  it('aceita uma pasta e desce nela', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'src/util/soma.js', 'soma');
    await escrever(repositorio, 'fora.js', 'fora');

    assert.deepEqual(await repositorio.adicionar(['src']), ['src/util/soma.js']);
  });

  it('add de novo atualiza o hash preparado', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'antes');
    await repositorio.adicionar(['.']);

    await escrever(repositorio, 'a.txt', 'depois');
    await repositorio.adicionar(['.']);

    assert.equal((await repositorio.indice.carregar()).obter('a.txt').hash, hashDe('blob', 'depois'));
  });

  it('caminho que não existe reclama', async () => {
    const repositorio = await repositorioNovo();

    await assert.rejects(() => repositorio.adicionar(['fantasma.txt']), /Não existe/);
  });

  it('rm tira do índice sem apagar do disco', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);

    assert.deepEqual(await repositorio.remover(['a.txt']), ['a.txt']);
    assert.equal((await repositorio.indice.carregar()).quantidade, 0);
    assert.ok(existsSync(join(repositorio.trabalho, 'a.txt')));
  });

  it('rm --do-disco apaga também', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);
    await repositorio.remover(['a.txt'], { doDisco: true });

    assert.equal(existsSync(join(repositorio.trabalho, 'a.txt')), false);
  });

  it('rm de uma pasta pega tudo dentro dela', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'src/a.js', 'a');
    await escrever(repositorio, 'src/b.js', 'b');
    await escrever(repositorio, 'fora.js', 'f');
    await repositorio.adicionar(['.']);

    assert.deepEqual(await repositorio.remover(['src']), ['src/a.js', 'src/b.js']);
  });
});

describe('commit', () => {
  it('grava o commit e move o ramo', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);

    const feito = await repositorio.commitar({ mensagem: 'primeiro', autor: AUTOR });

    assert.equal(feito.primeiro, true);
    assert.equal(feito.ramo, RAMO_PADRAO);
    assert.equal((await repositorio.cabeca()).hash, feito.hash);
  });

  it('o ramo é só um arquivo com o hash dentro', async () => {
    // Não existe estrutura de ramo nenhuma — por isso criar ramo é barato.
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);

    const feito = await repositorio.commitar({ mensagem: 'x', autor: AUTOR });
    const arquivo = join(repositorio.controle, 'refs', 'heads', RAMO_PADRAO);

    assert.equal((await readFile(arquivo, 'utf8')).trim(), feito.hash);
  });

  it('o segundo commit aponta para o primeiro', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);
    const um = await repositorio.commitar({ mensagem: 'um', autor: AUTOR });

    await escrever(repositorio, 'a.txt', 'a alterado');
    await repositorio.adicionar(['.']);
    const dois = await repositorio.commitar({ mensagem: 'dois', autor: AUTOR });

    assert.deepEqual((await repositorio.commit(dois.hash)).pais, [um.hash]);
  });

  it('a tree do commit tem os arquivos preparados', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'leiame.md', 'doc');
    await escrever(repositorio, 'src/a.js', 'a');
    await repositorio.adicionar(['.']);

    const feito = await repositorio.commitar({ mensagem: 'x', autor: AUTOR });
    const arquivos = await lerArvoreInteira(repositorio.deposito, feito.arvore);

    assert.deepEqual(arquivos.map((a) => a.caminho).sort(), ['leiame.md', 'src/a.js']);
  });

  it('commitar sem nada preparado reclama', async () => {
    const repositorio = await repositorioNovo();

    await assert.rejects(() => repositorio.commitar({ mensagem: 'vazio', autor: AUTOR }), /Nada preparado/);
  });

  it('commitar sem mudança nenhuma reclama', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);
    await repositorio.commitar({ mensagem: 'um', autor: AUTOR });

    await assert.rejects(() => repositorio.commitar({ mensagem: 'de novo', autor: AUTOR }), /Nada mudou/);
  });

  it('dois commits com o mesmo conteúdo e instantes diferentes têm hashes diferentes', async () => {
    // O instante entra no objeto, então o hash não é só do conteúdo da tree.
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);

    const um = await repositorio.commitar({
      mensagem: 'x',
      autor: AUTOR,
      quando: new Date(1_700_000_000_000),
      permitirVazio: true,
    });

    const dois = await repositorio.commitar({
      mensagem: 'x',
      autor: AUTOR,
      quando: new Date(1_700_000_060_000),
      permitirVazio: true,
    });

    assert.notEqual(um.hash, dois.hash);
  });

  it('o histórico vem do mais novo para o mais velho', async () => {
    const repositorio = await repositorioNovo();

    for (const texto of ['um', 'dois', 'três']) {
      await escrever(repositorio, 'a.txt', texto);
      await repositorio.adicionar(['.']);
      await repositorio.commitar({ mensagem: texto, autor: AUTOR });
    }

    assert.deepEqual((await repositorio.historico()).map((c) => c.resumo), ['três', 'dois', 'um']);
  });

  it('o histórico respeita o limite', async () => {
    const repositorio = await repositorioNovo();

    for (const texto of ['um', 'dois', 'três']) {
      await escrever(repositorio, 'a.txt', texto);
      await repositorio.adicionar(['.']);
      await repositorio.commitar({ mensagem: texto, autor: AUTOR });
    }

    assert.equal((await repositorio.historico({ limite: 2 })).length, 2);
  });

  it('repositório sem commit tem histórico vazio', async () => {
    assert.deepEqual(await (await repositorioNovo()).historico(), []);
  });

  it('pedir um commit que é blob reclama', async () => {
    const repositorio = await repositorioNovo();
    const hash = await repositorio.deposito.escrever('blob', 'não sou commit');

    await assert.rejects(() => repositorio.commit(hash), /não um commit/);
  });
});

describe('situação', () => {
  it('repositório recém-criado está limpo', async () => {
    const situacao = await (await repositorioNovo()).situacao();

    assert.equal(situacao.limpo, true);
    assert.equal(situacao.commit, null);
  });

  it('arquivo novo aparece como não rastreado', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');

    const situacao = await repositorio.situacao();

    assert.deepEqual(situacao.naoRastreados, ['a.txt']);
    assert.equal(situacao.limpo, false);
  });

  it('depois do add ele fica preparado como novo', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);

    const situacao = await repositorio.situacao();

    assert.deepEqual(situacao.preparados.novos, ['a.txt']);
    assert.deepEqual(situacao.naoRastreados, []);
  });

  it('depois do commit some de todas as listas', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);
    await repositorio.commitar({ mensagem: 'x', autor: AUTOR });

    assert.equal((await repositorio.situacao()).limpo, true);
  });

  it('um arquivo pode estar preparado e alterado ao mesmo tempo', async () => {
    // É o comportamento certo, não um bug: são três estados, não dois.
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'versão preparada');
    await repositorio.adicionar(['.']);
    await escrever(repositorio, 'a.txt', 'versão do disco');

    const situacao = await repositorio.situacao();

    assert.deepEqual(situacao.preparados.novos, ['a.txt']);
    assert.deepEqual(situacao.naoPreparados.modificados, ['a.txt']);
  });

  it('alterar depois do commit aparece como não preparado', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);
    await repositorio.commitar({ mensagem: 'x', autor: AUTOR });

    await escrever(repositorio, 'a.txt', 'a alterado');

    const situacao = await repositorio.situacao();

    assert.deepEqual(situacao.naoPreparados.modificados, ['a.txt']);
    assert.deepEqual(situacao.preparados.modificados, []);
  });

  it('apagar do disco aparece como sumido', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await repositorio.adicionar(['.']);
    await repositorio.commitar({ mensagem: 'x', autor: AUTOR });
    await rm(join(repositorio.trabalho, 'a.txt'));

    assert.deepEqual((await repositorio.situacao()).naoPreparados.removidos, ['a.txt']);
  });

  it('tirar do índice o que já foi commitado aparece como remoção preparada', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'a');
    await escrever(repositorio, 'b.txt', 'b');
    await repositorio.adicionar(['.']);
    await repositorio.commitar({ mensagem: 'x', autor: AUTOR });
    await repositorio.remover(['a.txt'], { doDisco: true });

    assert.deepEqual((await repositorio.situacao()).preparados.removidos, ['a.txt']);
  });

  it('o mesmo conteúdo em dois arquivos usa um blob só', async () => {
    const repositorio = await repositorioNovo();

    await escrever(repositorio, 'a.txt', 'idêntico');
    await escrever(repositorio, 'b.txt', 'idêntico');
    await repositorio.adicionar(['.']);

    const indice = await repositorio.indice.carregar();

    assert.equal(indice.obter('a.txt').hash, indice.obter('b.txt').hash);
  });
});
