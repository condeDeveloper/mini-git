/**
 * O depósito de objetos.
 *
 * Os objetos ficam em `.migit/objects/ab/cdef...`: os dois primeiros
 * caracteres do hash viram pasta. Não é enfeite — é o que evita um diretório
 * com centenas de milhares de arquivos, que em vários sistemas de arquivos
 * fica lento só de listar.
 *
 * Cada arquivo é comprimido com zlib, o mesmo formato do Git de verdade, então
 * um `.migit/objects` pode ser lido por ferramentas externas.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

import { ErroDeObjeto, desempacotar, ehHash, empacotar, hashDeBytes } from './objetos.js';

/** Onde os objetos vivem dentro do repositório. */
export const PASTA = 'objects';

/** Guarda e recupera objetos por hash. */
export class Deposito {
  /** @param {string} raiz caminho do diretório `.migit`. */
  constructor(raiz) {
    this.raiz = raiz;
    this.objetos = join(raiz, PASTA);
  }

  /** O caminho em disco de um hash. */
  caminhoDe(hash) {
    if (!ehHash(hash)) throw new ErroDeObjeto(`Hash inválido: ${JSON.stringify(hash)}.`);

    return join(this.objetos, hash.slice(0, 2), hash.slice(2));
  }

  /**
   * Grava um objeto e devolve o hash.
   *
   * Se o objeto já existe, não regrava: o conteúdo seria idêntico, porque o
   * nome do arquivo *é* o hash do conteúdo. É daí que vem a deduplicação do
   * Git — dez commits que não mexem num arquivo apontam todos para o mesmo
   * blob.
   */
  async escrever(tipo, conteudo) {
    const bytes = empacotar(tipo, conteudo);
    const hash = hashDeBytes(bytes);
    const caminho = this.caminhoDe(hash);

    if (existsSync(caminho)) return hash;

    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, deflateSync(bytes));

    return hash;
  }

  /** Lê um objeto pelo hash completo. */
  async ler(hash) {
    const caminho = this.caminhoDe(hash);

    let bruto;

    try {
      bruto = await readFile(caminho);
    } catch {
      throw new ErroDeObjeto(`Objeto não encontrado: ${hash}.`);
    }

    const objeto = desempacotar(inflateSync(bruto));

    // O hash é a garantia de integridade do formato inteiro: se o conteúdo
    // mudou debaixo do arquivo, o nome deixa de bater e é melhor saber agora.
    const conferido = hashDeBytes(empacotar(objeto.tipo, objeto.conteudo));

    if (conferido !== hash) {
      throw new ErroDeObjeto(`Objeto corrompido: ${hash} contém algo com hash ${conferido}.`);
    }

    return objeto;
  }

  /** Indica se o objeto está guardado. */
  existe(hash) {
    try {
      return existsSync(this.caminhoDe(hash));
    } catch {
      return false;
    }
  }

  /**
   * Completa um hash abreviado.
   *
   * É o que deixa `migit cat-file c09fc3c` funcionar. Se o prefixo casa com
   * mais de um objeto, é ambíguo e não dá para adivinhar — melhor recusar do
   * que escolher o errado em silêncio.
   */
  async resolver(prefixo) {
    if (typeof prefixo !== 'string' || prefixo.length < 4) {
      throw new ErroDeObjeto('Informe pelo menos 4 caracteres do hash.');
    }

    const curto = prefixo.toLowerCase();

    if (ehHash(curto)) {
      if (!this.existe(curto)) throw new ErroDeObjeto(`Objeto não encontrado: ${curto}.`);
      return curto;
    }

    const pasta = curto.slice(0, 2);
    const resto = curto.slice(2);

    let nomes;

    try {
      nomes = await readdir(join(this.objetos, pasta));
    } catch {
      throw new ErroDeObjeto(`Objeto não encontrado: ${curto}.`);
    }

    const casaram = nomes.filter((nome) => nome.startsWith(resto)).map((nome) => pasta + nome);

    if (casaram.length === 0) throw new ErroDeObjeto(`Objeto não encontrado: ${curto}.`);

    if (casaram.length > 1) {
      throw new ErroDeObjeto(`O prefixo ${curto} é ambíguo: ${casaram.join(', ')}.`);
    }

    return casaram[0];
  }

  /** Todos os hashes guardados, para inspeção e teste. */
  async todos() {
    let pastas;

    try {
      pastas = await readdir(this.objetos);
    } catch {
      return [];
    }

    const hashes = [];

    for (const pasta of pastas.sort()) {
      if (pasta.length !== 2) continue;

      for (const nome of (await readdir(join(this.objetos, pasta))).sort()) {
        hashes.push(pasta + nome);
      }
    }

    return hashes;
  }
}
