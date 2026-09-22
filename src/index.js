/**
 * mini-git — os objetos do Git, do zero.
 *
 * Ponto de entrada da biblioteca. A linha de comando (`src/cli.js`) é só uma
 * casca em cima disto.
 */

export { Deposito } from './deposito.js';
export { Indice, CABECALHO } from './indice.js';
export { Repositorio, ErroDeRepositorio, ignorar, PASTA_DE_CONTROLE, RAMO_PADRAO, SEMPRE_IGNORADOS } from './repositorio.js';

export {
  ErroDeObjeto,
  TIPOS,
  bytesParaHash,
  desempacotar,
  ehHash,
  empacotar,
  hashDe,
  hashDeBytes,
  hashParaBytes,
} from './objetos.js';

export {
  MODOS,
  chaveDeOrdem,
  ehPasta,
  gravarArvore,
  lerArvore,
  lerArvoreInteira,
  ordenar,
  serializarArvore,
} from './arvore.js';

export { assinar, fusoDe, lerAssinatura, lerCommit, resumoDe, serializarCommit } from './commit.js';
