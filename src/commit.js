/**
 * Os commits.
 *
 * Um commit é texto simples: a tree, os pais, quem escreveu, quem registrou e
 * a mensagem. Como o hash cobre tudo isso — inclusive o hash do pai —, mudar
 * qualquer commit antigo muda o hash dele, o que muda o do filho, e assim até
 * o topo. É essa corrente, e não uma verificação à parte, que torna o
 * histórico difícil de adulterar sem que apareça.
 */

import { ErroDeObjeto } from './objetos.js';

/**
 * Formata o fuso como o Git formata: `+0300`, `-0300`.
 *
 * `getTimezoneOffset` devolve **minutos atrás do UTC**, então o sinal é o
 * contrário do que se espera — o Brasil dá +180, e o texto certo é `-0300`.
 */
export function fusoDe(data = new Date()) {
  const minutos = -data.getTimezoneOffset();
  const sinal = minutos < 0 ? '-' : '+';
  const inteiro = Math.abs(minutos);
  const horas = String(Math.floor(inteiro / 60)).padStart(2, '0');
  const resto = String(inteiro % 60).padStart(2, '0');

  return `${sinal}${horas}${resto}`;
}

/** Monta a linha de assinatura: `Nome <email> 1700000000 -0300`. */
export function assinar({ nome, email, quando = new Date(), fuso = fusoDe(quando) }) {
  if (!nome || !email) throw new ErroDeObjeto('Um commit precisa de nome e e-mail.');

  // O `<` e o `>` delimitam o e-mail e o `\n` separa os campos: deixar passar
  // quebraria o formato de um jeito que só apareceria na leitura.
  if (/[<>\n]/.test(nome) || /[<>\n]/.test(email)) {
    throw new ErroDeObjeto('Nome e e-mail não podem conter "<", ">" nem quebra de linha.');
  }

  const segundos = Math.floor(quando.getTime() / 1000);

  return `${nome} <${email}> ${segundos} ${fuso}`;
}

/** Lê uma linha de assinatura de volta. */
export function lerAssinatura(linha) {
  const casou = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(linha);

  if (!casou) throw new ErroDeObjeto(`Assinatura malformada: ${JSON.stringify(linha)}.`);

  return {
    nome: casou[1],
    email: casou[2],
    segundos: Number(casou[3]),
    fuso: casou[4],
    quando: new Date(Number(casou[3]) * 1000),
  };
}

/** Monta os bytes de um commit. */
export function serializarCommit({ arvore, pais = [], autor, registrador = autor, mensagem }) {
  if (!arvore) throw new ErroDeObjeto('Um commit precisa apontar para uma tree.');

  const texto = (mensagem ?? '').trim();

  if (!texto) throw new ErroDeObjeto('Um commit precisa de mensagem.');

  const linhas = [`tree ${arvore}`];

  for (const pai of pais) linhas.push(`parent ${pai}`);

  linhas.push(`author ${autor}`, `committer ${registrador}`, '', `${texto}\n`);

  return Buffer.from(linhas.join('\n'), 'utf8');
}

/** Lê os bytes de um commit de volta. */
export function lerCommit(bytes) {
  const texto = bytes.toString('utf8');
  const corte = texto.indexOf('\n\n');

  if (corte < 0) throw new ErroDeObjeto('Commit sem a linha em branco que separa o cabeçalho.');

  const commit = { arvore: null, pais: [], autor: null, registrador: null, mensagem: texto.slice(corte + 2).trim() };

  for (const linha of texto.slice(0, corte).split('\n')) {
    const espaco = linha.indexOf(' ');
    const campo = linha.slice(0, espaco);
    const valor = linha.slice(espaco + 1);

    if (campo === 'tree') commit.arvore = valor;
    else if (campo === 'parent') commit.pais.push(valor);
    else if (campo === 'author') commit.autor = valor;
    else if (campo === 'committer') commit.registrador = valor;
  }

  if (!commit.arvore) throw new ErroDeObjeto('Commit sem tree.');

  return commit;
}

/** A primeira linha da mensagem, que é o que o log mostra. */
export function resumoDe(mensagem) {
  return (mensagem ?? '').split('\n')[0].trim();
}
