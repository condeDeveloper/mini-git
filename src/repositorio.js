/**
 * O repositório: onde as peças se encontram.
 *
 * Um repositório é o depósito de objetos, o índice e as referências. As
 * referências são a parte que costuma surpreender: um ramo é um **arquivo de
 * texto com 40 caracteres dentro**. Não há estrutura de ramo nenhuma — criar
 * um ramo é escrever um arquivo, e é por isso que é barato.
 *
 * `HEAD` é um arquivo apontando para outro arquivo (`ref: refs/heads/...`).
 * Essa indireção é o que faz o commit mover o ramo sozinho: o commit escreve
 * no que o HEAD aponta, não no HEAD.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { MODOS, gravarArvore, lerArvoreInteira } from './arvore.js';
import { Deposito } from './deposito.js';
import { Indice } from './indice.js';
import { assinar, lerCommit, resumoDe, serializarCommit } from './commit.js';
import { ErroDeObjeto, hashDe } from './objetos.js';

/** Nome da pasta de controle. Não é `.git` de propósito: dá para usar os dois lado a lado. */
export const PASTA_DE_CONTROLE = '.migit';

/** Ramo criado no `iniciar`. */
export const RAMO_PADRAO = 'principal';

/** Pastas que nunca entram, mesmo sem arquivo de exclusão. */
export const SEMPRE_IGNORADOS = [PASTA_DE_CONTROLE, '.git', 'node_modules'];

/** Algo que o repositório não consegue fazer. */
export class ErroDeRepositorio extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeRepositorio';
  }
}

/** Decide se um caminho relativo deve ser ignorado. */
export function ignorar(caminho, padroes = []) {
  const partes = caminho.split('/');

  if (partes.some((parte) => SEMPRE_IGNORADOS.includes(parte))) return true;

  return padroes.some((padrao) => {
    const limpo = padrao.replace(/\/$/, '');

    if (limpo.startsWith('*.')) return caminho.endsWith(limpo.slice(1));
    if (limpo.includes('/')) return caminho === limpo || caminho.startsWith(`${limpo}/`);

    return partes.includes(limpo);
  });
}

/** Um repositório aberto. */
export class Repositorio {
  constructor(trabalho) {
    this.trabalho = resolve(trabalho);
    this.controle = join(this.trabalho, PASTA_DE_CONTROLE);
    this.deposito = new Deposito(this.controle);
    this.indice = new Indice(join(this.controle, 'index'));
  }

  /** Cria um repositório novo. Rodar duas vezes não apaga nada. */
  static async iniciar(diretorio = process.cwd()) {
    const repositorio = new Repositorio(diretorio);

    if (existsSync(repositorio.controle)) {
      return { repositorio, criado: false };
    }

    await mkdir(join(repositorio.controle, 'objects'), { recursive: true });
    await mkdir(join(repositorio.controle, 'refs', 'heads'), { recursive: true });
    await writeFile(join(repositorio.controle, 'HEAD'), `ref: refs/heads/${RAMO_PADRAO}\n`, 'utf8');

    return { repositorio, criado: true };
  }

  /**
   * Abre o repositório a partir de um diretório qualquer, subindo até achar.
   *
   * É o que deixa rodar `migit log` de dentro de `src/util/` sem pensar.
   */
  static async abrir(diretorio = process.cwd()) {
    let atual = resolve(diretorio);

    for (;;) {
      if (existsSync(join(atual, PASTA_DE_CONTROLE))) return new Repositorio(atual);

      const acima = dirname(atual);

      if (acima === atual) {
        throw new ErroDeRepositorio(`Nenhum repositório ${PASTA_DE_CONTROLE} aqui nem acima.`);
      }

      atual = acima;
    }
  }

  // ---------------------------------------------------------------- referências

  /** Lê o HEAD: o ramo apontado e o commit em que ele está. */
  async cabeca() {
    const bruto = (await readFile(join(this.controle, 'HEAD'), 'utf8')).trim();

    if (bruto.startsWith('ref: ')) {
      const ref = bruto.slice(5).trim();

      return { ref, ramo: ref.replace('refs/heads/', ''), hash: await this.lerRef(ref) };
    }

    // HEAD solto (detached): aponta direto para um commit, sem ramo.
    return { ref: null, ramo: null, hash: bruto };
  }

  /** Lê uma referência. Ramo que ainda não tem commit devolve null. */
  async lerRef(ref) {
    const caminho = join(this.controle, ...ref.split('/'));

    if (!existsSync(caminho)) return null;

    return (await readFile(caminho, 'utf8')).trim() || null;
  }

  /** Grava uma referência. */
  async gravarRef(ref, hash) {
    const caminho = join(this.controle, ...ref.split('/'));

    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, `${hash}\n`, 'utf8');
  }

  /** Os ramos existentes. */
  async ramos() {
    const pasta = join(this.controle, 'refs', 'heads');

    if (!existsSync(pasta)) return [];

    return (await readdir(pasta)).sort();
  }

  // ------------------------------------------------------------------ trabalho

  /** Os padrões de `.migitignore`, se houver. */
  async padroesIgnorados() {
    const caminho = join(this.trabalho, '.migitignore');

    if (!existsSync(caminho)) return [];

    return (await readFile(caminho, 'utf8'))
      .split('\n')
      .map((linha) => linha.trim())
      .filter((linha) => linha && !linha.startsWith('#'));
  }

  /** Lista os arquivos do diretório de trabalho, em caminhos relativos com barra. */
  async arquivosDeTrabalho(subdiretorio = '.') {
    const padroes = await this.padroesIgnorados();
    const achados = [];

    const andar = async (absoluto) => {
      for (const item of (await readdir(absoluto, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const cheio = join(absoluto, item.name);
        const rel = relative(this.trabalho, cheio).split(sep).join('/');

        if (ignorar(rel, padroes)) continue;

        if (item.isDirectory()) await andar(cheio);
        else if (item.isFile()) achados.push(rel);
      }
    };

    const partida = resolve(this.trabalho, subdiretorio);

    if (!existsSync(partida)) throw new ErroDeRepositorio(`Não existe: ${subdiretorio}.`);

    if ((await stat(partida)).isFile()) {
      const rel = relative(this.trabalho, partida).split(sep).join('/');

      return ignorar(rel, padroes) ? [] : [rel];
    }

    await andar(partida);

    return achados;
  }

  /** O modo de um arquivo: só distingue executável de comum, como o Git. */
  async modoDe(caminho) {
    const info = await stat(join(this.trabalho, caminho));

    // No Windows o bit de execução não significa nada, e confiar nele geraria
    // trees diferentes para o mesmo projeto em máquinas diferentes.
    if (process.platform !== 'win32' && (info.mode & 0o111) !== 0) return MODOS.executavel;

    return MODOS.arquivo;
  }

  // -------------------------------------------------------------------- add

  /** Prepara arquivos ou pastas. Devolve os caminhos preparados. */
  async adicionar(alvos = ['.']) {
    await this.indice.carregar();

    const preparados = [];

    for (const alvo of alvos) {
      for (const caminho of await this.arquivosDeTrabalho(alvo)) {
        const conteudo = await readFile(join(this.trabalho, caminho));
        const hash = await this.deposito.escrever('blob', conteudo);

        this.indice.adicionar(caminho, hash, await this.modoDe(caminho));
        preparados.push(caminho);
      }
    }

    await this.indice.gravar();

    return preparados.sort();
  }

  /** Tira arquivos da preparação (e, se pedido, do disco). */
  async remover(alvos, { doDisco = false } = {}) {
    await this.indice.carregar();

    const removidos = [];

    for (const alvo of alvos) {
      const prefixo = alvo.split(sep).join('/').replace(/^\.\//, '');

      for (const entrada of this.indice.ordenadas()) {
        if (entrada.caminho !== prefixo && !entrada.caminho.startsWith(`${prefixo}/`)) continue;

        this.indice.remover(entrada.caminho);
        removidos.push(entrada.caminho);

        if (doDisco) await rm(join(this.trabalho, entrada.caminho), { force: true });
      }
    }

    await this.indice.gravar();

    return removidos;
  }

  // ----------------------------------------------------------------- commit

  /** Grava um commit com o que está no índice. */
  async commitar({ mensagem, autor, quando = new Date(), permitirVazio = false }) {
    await this.indice.carregar();

    if (this.indice.quantidade === 0 && !permitirVazio) {
      throw new ErroDeRepositorio('Nada preparado para commitar. Use `migit add` antes.');
    }

    const cabeca = await this.cabeca();
    const arvore = await gravarArvore(this.deposito, this.indice.ordenadas());

    // Commit que não muda nada é quase sempre engano — o Git também recusa.
    if (cabeca.hash && !permitirVazio) {
      const anterior = lerCommit((await this.deposito.ler(cabeca.hash)).conteudo);

      if (anterior.arvore === arvore) {
        throw new ErroDeRepositorio('Nada mudou desde o último commit.');
      }
    }

    const assinatura = assinar({ ...autor, quando });
    const bytes = serializarCommit({
      arvore,
      pais: cabeca.hash ? [cabeca.hash] : [],
      autor: assinatura,
      mensagem,
    });

    const hash = await this.deposito.escrever('commit', bytes);

    await this.gravarRef(cabeca.ref ?? `refs/heads/${RAMO_PADRAO}`, hash);

    return { hash, arvore, primeiro: !cabeca.hash, ramo: cabeca.ramo ?? RAMO_PADRAO };
  }

  /** Lê um commit pelo hash (aceita abreviado). */
  async commit(referencia) {
    const hash = await this.deposito.resolver(referencia);
    const { tipo, conteudo } = await this.deposito.ler(hash);

    if (tipo !== 'commit') throw new ErroDeObjeto(`${referencia} é um ${tipo}, não um commit.`);

    return { hash, ...lerCommit(conteudo) };
  }

  /** O histórico a partir do HEAD, do mais novo para o mais velho. */
  async historico({ de = null, limite = Infinity } = {}) {
    const inicio = de ?? (await this.cabeca()).hash;

    if (!inicio) return [];

    const commits = [];
    const vistos = new Set();
    let atual = inicio;

    while (atual && commits.length < limite) {
      if (vistos.has(atual)) break;

      vistos.add(atual);

      const commit = await this.commit(atual);

      commits.push({ ...commit, resumo: resumoDe(commit.mensagem) });
      atual = commit.pais[0] ?? null;
    }

    return commits;
  }

  // ---------------------------------------------------------------- situação

  /** Os arquivos do último commit, como um mapa caminho → hash. */
  async arquivosDoCabeca() {
    const cabeca = await this.cabeca();

    if (!cabeca.hash) return new Map();

    const commit = await this.commit(cabeca.hash);
    const arquivos = await lerArvoreInteira(this.deposito, commit.arvore);

    return new Map(arquivos.map((a) => [a.caminho, a.hash]));
  }

  /**
   * Compara os três estados: último commit, índice e diretório de trabalho.
   *
   * São três porque o índice existe. Um arquivo pode estar preparado *e*
   * modificado depois disso — e aparecer nas duas listas ao mesmo tempo é o
   * comportamento certo, não um bug.
   */
  async situacao() {
    await this.indice.carregar();

    const cabeca = await this.cabeca();
    const noCommit = await this.arquivosDoCabeca();
    const noTrabalho = new Set(await this.arquivosDeTrabalho());

    const preparados = { novos: [], modificados: [], removidos: [] };
    const naoPreparados = { modificados: [], removidos: [] };
    const naoRastreados = [];

    for (const entrada of this.indice.ordenadas()) {
      const antes = noCommit.get(entrada.caminho);

      if (antes === undefined) preparados.novos.push(entrada.caminho);
      else if (antes !== entrada.hash) preparados.modificados.push(entrada.caminho);

      if (!noTrabalho.has(entrada.caminho)) {
        naoPreparados.removidos.push(entrada.caminho);
        continue;
      }

      const conteudo = await readFile(join(this.trabalho, entrada.caminho));

      if (hashDe('blob', conteudo) !== entrada.hash) naoPreparados.modificados.push(entrada.caminho);
    }

    for (const caminho of noCommit.keys()) {
      if (!this.indice.obter(caminho)) preparados.removidos.push(caminho);
    }

    for (const caminho of noTrabalho) {
      if (!this.indice.obter(caminho)) naoRastreados.push(caminho);
    }

    return {
      ramo: cabeca.ramo,
      commit: cabeca.hash,
      preparados,
      naoPreparados,
      naoRastreados: naoRastreados.sort(),
      limpo:
        preparados.novos.length === 0 &&
        preparados.modificados.length === 0 &&
        preparados.removidos.length === 0 &&
        naoPreparados.modificados.length === 0 &&
        naoPreparados.removidos.length === 0 &&
        naoRastreados.length === 0,
    };
  }
}
