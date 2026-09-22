/**
 * As trees — os diretórios.
 *
 * Uma tree é uma lista de entradas `<modo> <nome>\0<20 bytes de hash>`. Só
 * isso. O nome do arquivo e o modo moram na tree, não no blob, e é por isso
 * que renomear um arquivo sem mudar o conteúdo não cria blob novo: só a tree
 * muda.
 *
 * O detalhe que quase todo mundo erra de primeira é a **ordem**. O Git ordena
 * as entradas por nome, mas comparando diretórios como se tivessem uma barra
 * no fim. Sem isso, `lib.js` e `lib/` saem trocados e a tree gera um hash
 * diferente do Git de verdade para exatamente o mesmo conteúdo.
 */

import { ErroDeObjeto, bytesParaHash, hashParaBytes } from './objetos.js';

/** Modos que este projeto usa. */
export const MODOS = {
  arquivo: '100644',
  executavel: '100755',
  pasta: '40000',
};

/** Indica se o modo é de diretório. */
export function ehPasta(modo) {
  return modo === MODOS.pasta || modo === '040000';
}

/**
 * A chave de ordenação de uma entrada.
 *
 * Diretório compara com uma barra no fim — é a regra do Git, e é o que
 * mantém o hash idêntico ao dele.
 */
export function chaveDeOrdem(entrada) {
  return ehPasta(entrada.modo) ? `${entrada.nome}/` : entrada.nome;
}

/** Ordena as entradas como o Git ordena. */
export function ordenar(entradas) {
  return [...entradas].sort((a, b) => {
    const x = chaveDeOrdem(a);
    const y = chaveDeOrdem(b);

    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Monta os bytes de uma tree. */
export function serializarArvore(entradas) {
  const vistos = new Set();

  for (const entrada of entradas) {
    if (!entrada.nome || entrada.nome.includes('/') || entrada.nome.includes('\0')) {
      throw new ErroDeObjeto(`Nome inválido numa tree: ${JSON.stringify(entrada.nome)}.`);
    }

    if (vistos.has(entrada.nome)) {
      throw new ErroDeObjeto(`Nome repetido na mesma tree: ${entrada.nome}.`);
    }

    vistos.add(entrada.nome);
  }

  const partes = ordenar(entradas).map((entrada) =>
    Buffer.concat([
      Buffer.from(`${entrada.modo} ${entrada.nome}\0`),
      hashParaBytes(entrada.hash),
    ]),
  );

  return Buffer.concat(partes);
}

/** Lê os bytes de uma tree de volta para entradas. */
export function lerArvore(bytes) {
  const entradas = [];
  let i = 0;

  while (i < bytes.length) {
    const nulo = bytes.indexOf(0, i);

    if (nulo < 0) throw new ErroDeObjeto('Tree truncada: falta o byte nulo do nome.');

    const cabecalho = bytes.subarray(i, nulo).toString('utf8');
    const espaco = cabecalho.indexOf(' ');

    if (espaco < 0) throw new ErroDeObjeto(`Entrada de tree malformada: ${JSON.stringify(cabecalho)}.`);

    const fim = nulo + 21;

    if (fim > bytes.length) throw new ErroDeObjeto('Tree truncada: falta o hash da entrada.');

    entradas.push({
      modo: cabecalho.slice(0, espaco),
      nome: cabecalho.slice(espaco + 1),
      hash: bytesParaHash(bytes.subarray(nulo + 1, fim)),
    });

    i = fim;
  }

  return entradas;
}

/**
 * Transforma uma lista plana de caminhos numa hierarquia de trees.
 *
 * O índice guarda `src/util/soma.js` como uma linha só; o depósito precisa de
 * três objetos (a tree de `util`, a de `src` e a raiz). Esta função faz essa
 * dobra, de baixo para cima, gravando cada tree e devolvendo o hash da raiz.
 *
 * @param {import('./deposito.js').Deposito} deposito
 * @param {{caminho: string, hash: string, modo: string}[]} arquivos
 * @returns {Promise<string>} hash da tree raiz
 */
export async function gravarArvore(deposito, arquivos) {
  /** Nó em memória: pastas viram sub-nós, arquivos viram folhas. */
  const raiz = { pastas: new Map(), arquivos: [] };

  for (const arquivo of arquivos) {
    const partes = arquivo.caminho.split('/').filter(Boolean);
    let no = raiz;

    for (const pasta of partes.slice(0, -1)) {
      if (!no.pastas.has(pasta)) no.pastas.set(pasta, { pastas: new Map(), arquivos: [] });
      no = no.pastas.get(pasta);
    }

    no.arquivos.push({
      nome: partes.at(-1),
      hash: arquivo.hash,
      modo: arquivo.modo ?? MODOS.arquivo,
    });
  }

  const gravar = async (no) => {
    const entradas = [...no.arquivos];

    for (const [nome, filho] of no.pastas) {
      entradas.push({ nome, modo: MODOS.pasta, hash: await gravar(filho) });
    }

    return deposito.escrever('tree', serializarArvore(entradas));
  };

  return gravar(raiz);
}

/**
 * Percorre uma tree inteira e devolve a lista plana de arquivos.
 *
 * É o caminho inverso do `gravarArvore`, e é o que permite comparar um commit
 * com o diretório de trabalho.
 */
export async function lerArvoreInteira(deposito, hash, prefixo = '') {
  const { tipo, conteudo } = await deposito.ler(hash);

  if (tipo !== 'tree') throw new ErroDeObjeto(`Esperava uma tree em ${hash}, veio ${tipo}.`);

  const arquivos = [];

  for (const entrada of lerArvore(conteudo)) {
    const caminho = prefixo ? `${prefixo}/${entrada.nome}` : entrada.nome;

    if (ehPasta(entrada.modo)) {
      arquivos.push(...(await lerArvoreInteira(deposito, entrada.hash, caminho)));
    } else {
      arquivos.push({ caminho, hash: entrada.hash, modo: entrada.modo });
    }
  }

  return arquivos;
}
