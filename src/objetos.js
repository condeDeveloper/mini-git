/**
 * Os objetos do Git.
 *
 * Tudo no Git é um objeto endereçado pelo próprio conteúdo: o nome do arquivo
 * é o SHA-1 do que está dentro dele. O formato é sempre
 * `<tipo> <tamanho>\0<conteúdo>`, e é justamente esse cabeçalho que faz um
 * blob com o texto "oi" ter um hash diferente de um commit que por acaso
 * tivesse os mesmos bytes.
 *
 * O que está aqui produz **exatamente** o mesmo hash que o `git hash-object`,
 * e há um teste comparando os dois.
 */

import { createHash } from 'node:crypto';

/** Os tipos de objeto que este projeto entende. */
export const TIPOS = ['blob', 'tree', 'commit'];

/** O objeto não pôde ser lido ou montado. */
export class ErroDeObjeto extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeObjeto';
  }
}

/** Monta os bytes completos do objeto, com cabeçalho. */
export function empacotar(tipo, conteudo) {
  if (!TIPOS.includes(tipo)) {
    throw new ErroDeObjeto(`Tipo desconhecido: ${tipo}. Conhecidos: ${TIPOS.join(', ')}.`);
  }

  const corpo = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);

  return Buffer.concat([Buffer.from(`${tipo} ${corpo.length}\0`), corpo]);
}

/** Separa o cabeçalho do conteúdo. */
export function desempacotar(bytes) {
  const fim = bytes.indexOf(0);

  if (fim < 0) {
    throw new ErroDeObjeto('Objeto sem o byte nulo que separa cabeçalho de conteúdo.');
  }

  const cabecalho = bytes.subarray(0, fim).toString('utf8');
  const espaco = cabecalho.indexOf(' ');

  if (espaco < 0) {
    throw new ErroDeObjeto(`Cabeçalho malformado: ${JSON.stringify(cabecalho)}.`);
  }

  const tipo = cabecalho.slice(0, espaco);
  const tamanho = Number(cabecalho.slice(espaco + 1));
  const conteudo = bytes.subarray(fim + 1);

  if (!TIPOS.includes(tipo)) {
    throw new ErroDeObjeto(`Tipo desconhecido no objeto: ${tipo}.`);
  }

  // O tamanho declarado precisa bater: se não bater, o objeto está corrompido
  // e ler adiante entregaria dado errado em silêncio.
  if (!Number.isInteger(tamanho) || tamanho !== conteudo.length) {
    throw new ErroDeObjeto(`Tamanho declarado (${tamanho}) não bate com o conteúdo (${conteudo.length}).`);
  }

  return { tipo, tamanho, conteudo };
}

/** O SHA-1 de um objeto já empacotado. */
export function hashDeBytes(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

/** O SHA-1 de um conteúdo, como o `git hash-object` faria. */
export function hashDe(tipo, conteudo) {
  return hashDeBytes(empacotar(tipo, conteudo));
}

/** Indica se o texto parece um SHA-1 completo. */
export function ehHash(texto) {
  return typeof texto === 'string' && /^[0-9a-f]{40}$/.test(texto);
}

/** Converte o SHA-1 em texto para os 20 bytes usados dentro das trees. */
export function hashParaBytes(hash) {
  if (!ehHash(hash)) {
    throw new ErroDeObjeto(`Hash inválido: ${JSON.stringify(hash)}.`);
  }

  return Buffer.from(hash, 'hex');
}

/** Converte os 20 bytes de volta em texto. */
export function bytesParaHash(bytes) {
  if (bytes.length !== 20) {
    throw new ErroDeObjeto(`Um hash tem 20 bytes, vieram ${bytes.length}.`);
  }

  return bytes.toString('hex');
}
