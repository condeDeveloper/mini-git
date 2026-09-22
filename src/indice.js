/**
 * O índice — a área de preparação.
 *
 * É o que o `git add` mexe. Ele existe porque o commit não é tirado do
 * diretório de trabalho: é tirado do índice. Essa separação é o que permite
 * preparar metade das mudanças de um arquivo e deixar o resto de fora, e é
 * também o que faz existirem três estados em vez de dois (trabalho, índice e
 * último commit).
 *
 * O índice do Git de verdade é binário e guarda `mtime`, `inode` e tamanho
 * para não precisar reler arquivo nenhum. Aqui o formato é texto e tem só o
 * essencial — o ganho de velocidade não vale a complexidade num projeto que
 * existe para ser lido.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { MODOS } from './arvore.js';
import { ErroDeObjeto, ehHash } from './objetos.js';

/** Cabeçalho do arquivo, para recusar formato desconhecido em vez de adivinhar. */
export const CABECALHO = 'migit-index 1';

/** A área de preparação. */
export class Indice {
  /** @param {string} caminho arquivo `.migit/index`. */
  constructor(caminho) {
    this.caminho = caminho;
    /** @type {Map<string, {caminho: string, hash: string, modo: string}>} */
    this.entradas = new Map();
  }

  /** Quantos arquivos estão preparados. */
  get quantidade() {
    return this.entradas.size;
  }

  /** Lê o índice do disco. Índice que não existe é um índice vazio. */
  async carregar() {
    this.entradas.clear();

    if (!existsSync(this.caminho)) return this;

    const texto = await readFile(this.caminho, 'utf8');
    const linhas = texto.split('\n').filter((linha) => linha.length > 0);

    if (linhas.length === 0) return this;

    if (linhas[0] !== CABECALHO) {
      throw new ErroDeObjeto(`Índice em formato desconhecido: ${JSON.stringify(linhas[0])}.`);
    }

    for (const linha of linhas.slice(1)) {
      const casou = /^(\d+) ([0-9a-f]{40}) (.+)$/.exec(linha);

      if (!casou) throw new ErroDeObjeto(`Linha de índice malformada: ${JSON.stringify(linha)}.`);

      this.entradas.set(casou[3], { caminho: casou[3], hash: casou[2], modo: casou[1] });
    }

    return this;
  }

  /**
   * Grava o índice.
   *
   * Sempre ordenado por caminho: um arquivo que muda de ordem a cada gravação
   * polui qualquer comparação e esconde a mudança real.
   */
  async gravar() {
    const linhas = [CABECALHO];

    for (const entrada of this.ordenadas()) {
      linhas.push(`${entrada.modo} ${entrada.hash} ${entrada.caminho}`);
    }

    await writeFile(this.caminho, `${linhas.join('\n')}\n`, 'utf8');

    return this;
  }

  /** As entradas em ordem de caminho. */
  ordenadas() {
    return [...this.entradas.values()].sort((a, b) => (a.caminho < b.caminho ? -1 : a.caminho > b.caminho ? 1 : 0));
  }

  /** Prepara um arquivo. Preparar o mesmo caminho de novo substitui. */
  adicionar(caminho, hash, modo = MODOS.arquivo) {
    if (!caminho || caminho.includes('\n')) {
      throw new ErroDeObjeto(`Caminho inválido no índice: ${JSON.stringify(caminho)}.`);
    }

    if (!ehHash(hash)) throw new ErroDeObjeto(`Hash inválido para ${caminho}: ${hash}.`);

    this.entradas.set(caminho, { caminho, hash, modo });

    return this;
  }

  /** Tira um arquivo da preparação. */
  remover(caminho) {
    return this.entradas.delete(caminho);
  }

  /** Busca uma entrada. */
  obter(caminho) {
    return this.entradas.get(caminho) ?? null;
  }

  /** Esvazia o índice. */
  limpar() {
    this.entradas.clear();

    return this;
  }

  /** Recarrega o índice a partir de uma lista de arquivos (usado após o commit). */
  substituirPor(arquivos) {
    this.limpar();

    for (const arquivo of arquivos) this.adicionar(arquivo.caminho, arquivo.hash, arquivo.modo);

    return this;
  }
}
