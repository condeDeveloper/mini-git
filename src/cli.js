#!/usr/bin/env node
/**
 * A linha de comando.
 *
 * Só traduz argumentos em chamadas de biblioteca e formata a saída. Toda
 * decisão de verdade está no `repositorio.js` — o que deixa a biblioteca
 * utilizável sem a CLI e a CLI testável sem processo filho.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Repositorio, PASTA_DE_CONTROLE } from './repositorio.js';
import { lerArvore, ehPasta } from './arvore.js';
import { lerAssinatura } from './commit.js';
import { hashDe } from './objetos.js';

const AJUDA = `mini-git — os objetos do Git, do zero

  migit iniciar                  cria um repositório ${PASTA_DE_CONTROLE} aqui
  migit add <caminhos...>        prepara arquivos ou pastas
  migit rm <caminhos...>         tira da preparação (--do-disco apaga também)
  migit commit -m "mensagem"     grava o que está preparado
  migit situacao                 o que mudou, nos três estados
  migit log [-n N]               o histórico a partir do HEAD
  migit mostrar <ref>            um commit por inteiro
  migit cat-file <hash>          o conteúdo de um objeto (-t só o tipo)
  migit ls-tree <hash>           as entradas de uma tree
  migit hash-object <arquivo>    o hash que o arquivo teria (não grava)
  migit ramos                    os ramos existentes

Autor do commit: MIGIT_AUTOR e MIGIT_EMAIL, ou "mini-git <migit@exemplo>".`;

/** De onde sai o autor do commit. */
export function autorDoAmbiente(ambiente = process.env) {
  return {
    nome: ambiente.MIGIT_AUTOR || 'mini-git',
    email: ambiente.MIGIT_EMAIL || 'migit@exemplo',
  };
}

/** Data legível no fuso registrado no próprio commit. */
export function formatarData(assinatura) {
  const { segundos, fuso } = assinatura;
  const minutos = (fuso[0] === '-' ? -1 : 1) * (Number(fuso.slice(1, 3)) * 60 + Number(fuso.slice(3)));
  const local = new Date((segundos + minutos * 60) * 1000);
  const dois = (n) => String(n).padStart(2, '0');

  return (
    `${dois(local.getUTCDate())}/${dois(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ` +
    `${dois(local.getUTCHours())}:${dois(local.getUTCMinutes())} ${fuso}`
  );
}

/** Lê os argumentos de um comando. */
export function lerArgumentos(argumentos) {
  const [comando = 'ajuda', ...resto] = argumentos;
  const opcoes = { comando, caminhos: [], mensagem: null, limite: Infinity, soTipo: false, doDisco: false };

  for (let i = 0; i < resto.length; i += 1) {
    const arg = resto[i];

    if (arg === '-m' || arg === '--mensagem') {
      opcoes.mensagem = resto[++i];

      if (opcoes.mensagem === undefined) throw new Error('Faltou a mensagem depois de -m.');
    } else if (arg === '-n' || arg === '--limite') {
      opcoes.limite = Number(resto[++i]);

      if (!Number.isInteger(opcoes.limite) || opcoes.limite <= 0) {
        throw new Error('O limite precisa ser um número inteiro positivo.');
      }
    } else if (arg === '-t' || arg === '--tipo') {
      opcoes.soTipo = true;
    } else if (arg === '--do-disco') {
      opcoes.doDisco = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Opção desconhecida: ${arg}.`);
    } else {
      opcoes.caminhos.push(arg);
    }
  }

  return opcoes;
}

/** Roda um comando e devolve o código de saída. */
export async function principal(argumentos, escrever = console.log, diretorio = process.cwd()) {
  let opcoes;

  try {
    opcoes = lerArgumentos(argumentos);
  } catch (erro) {
    escrever(erro.message);
    return 2;
  }

  if (['ajuda', '--ajuda', '-h', 'help'].includes(opcoes.comando)) {
    escrever(AJUDA);
    return 0;
  }

  try {
    return await despachar(opcoes, escrever, diretorio);
  } catch (erro) {
    escrever(erro.message);
    return 1;
  }
}

/** Os comandos que existem. */
export const COMANDOS = [
  'iniciar', 'init', 'add', 'rm', 'commit', 'situacao', 'status',
  'log', 'mostrar', 'show', 'cat-file', 'ls-tree', 'hash-object', 'ramos',
];

async function despachar(opcoes, escrever, diretorio) {
  // O nome é conferido antes de abrir o repositório: senão `migit voar` fora
  // de um repositório reclamaria do repositório, e não do comando — que é o
  // que a pessoa errou.
  if (!COMANDOS.includes(opcoes.comando)) {
    escrever(`Comando desconhecido: ${opcoes.comando}.\n\n${AJUDA}`);
    return 2;
  }

  if (['iniciar', 'init'].includes(opcoes.comando)) {
    const { repositorio, criado } = await Repositorio.iniciar(diretorio);

    escrever(criado ? `Repositório criado em ${repositorio.controle}` : 'Já existe um repositório aqui.');

    return 0;
  }

  // `hash-object` é o único que não precisa de repositório: ele só calcula.
  if (opcoes.comando === 'hash-object') {
    if (opcoes.caminhos.length === 0) throw new Error('Informe o arquivo.');

    for (const caminho of opcoes.caminhos) {
      escrever(hashDe('blob', await readFile(caminho)));
    }

    return 0;
  }

  const repositorio = await Repositorio.abrir(diretorio);

  switch (opcoes.comando) {
    case 'add': {
      const alvos = opcoes.caminhos.length > 0 ? opcoes.caminhos : ['.'];
      const preparados = await repositorio.adicionar(alvos);

      escrever(preparados.length === 0 ? 'Nada para preparar.' : `${preparados.length} arquivo(s) preparado(s).`);

      for (const caminho of preparados) escrever(`  + ${caminho}`);

      return 0;
    }

    case 'rm': {
      if (opcoes.caminhos.length === 0) throw new Error('Informe o que remover.');

      const removidos = await repositorio.remover(opcoes.caminhos, { doDisco: opcoes.doDisco });

      escrever(removidos.length === 0 ? 'Nada no índice com esse caminho.' : `${removidos.length} removido(s).`);

      return 0;
    }

    case 'commit': {
      if (!opcoes.mensagem) throw new Error('Um commit precisa de mensagem: use -m "...".');

      const feito = await repositorio.commitar({
        mensagem: opcoes.mensagem,
        autor: autorDoAmbiente(),
      });

      const raiz = feito.primeiro ? ' (primeiro)' : '';

      escrever(`[${feito.ramo}${raiz} ${feito.hash.slice(0, 7)}] ${opcoes.mensagem}`);

      return 0;
    }

    case 'situacao':
    case 'status': {
      escreverSituacao(await repositorio.situacao(), escrever);
      return 0;
    }

    case 'log': {
      const commits = await repositorio.historico({ limite: opcoes.limite });

      if (commits.length === 0) {
        escrever('Nenhum commit ainda.');
        return 0;
      }

      for (const commit of commits) {
        const autor = lerAssinatura(commit.autor);

        escrever(`${commit.hash.slice(0, 7)}  ${formatarData(autor)}  ${autor.nome}`);
        escrever(`         ${commit.resumo}`);
      }

      return 0;
    }

    case 'mostrar':
    case 'show': {
      const commit = await repositorio.commit(opcoes.caminhos[0] ?? (await repositorio.cabeca()).hash);

      escrever(`commit ${commit.hash}`);
      escrever(`tree   ${commit.arvore}`);

      for (const pai of commit.pais) escrever(`pai    ${pai}`);

      escrever(`autor  ${commit.autor}`);
      escrever('');
      escrever(commit.mensagem);

      return 0;
    }

    case 'cat-file': {
      if (opcoes.caminhos.length === 0) throw new Error('Informe o hash.');

      const hash = await repositorio.deposito.resolver(opcoes.caminhos[0]);
      const { tipo, conteudo } = await repositorio.deposito.ler(hash);

      if (opcoes.soTipo) {
        escrever(tipo);
        return 0;
      }

      escrever(tipo === 'tree' ? formatarArvore(conteudo) : conteudo.toString('utf8').replace(/\n$/, ''));

      return 0;
    }

    case 'ls-tree': {
      if (opcoes.caminhos.length === 0) throw new Error('Informe o hash da tree.');

      const hash = await repositorio.deposito.resolver(opcoes.caminhos[0]);
      const { tipo, conteudo } = await repositorio.deposito.ler(hash);

      if (tipo !== 'tree') throw new Error(`${opcoes.caminhos[0]} é um ${tipo}, não uma tree.`);

      escrever(formatarArvore(conteudo));

      return 0;
    }

    case 'ramos': {
      const cabeca = await repositorio.cabeca();

      for (const ramo of await repositorio.ramos()) {
        escrever(`${ramo === cabeca.ramo ? '*' : ' '} ${ramo}`);
      }

      return 0;
    }

    /* c8 ignore next 3 -- só chega aqui se COMANDOS listar algo sem caso. */
    default:
      throw new Error(`O comando ${opcoes.comando} está na lista mas não foi implementado.`);
  }
}

/** As entradas de uma tree, uma por linha. */
export function formatarArvore(conteudo) {
  return lerArvore(conteudo)
    .map((e) => `${e.modo.padStart(6, '0')} ${ehPasta(e.modo) ? 'tree' : 'blob'} ${e.hash}  ${e.nome}`)
    .join('\n');
}

/** A situação, agrupada como o `git status` agrupa. */
export function escreverSituacao(situacao, escrever) {
  escrever(`No ramo ${situacao.ramo ?? '(solto)'}${situacao.commit ? '' : ' — nenhum commit ainda'}`);

  const bloco = (titulo, caminhos, marca) => {
    if (caminhos.length === 0) return;

    escrever(`\n${titulo}:`);

    for (const caminho of caminhos) escrever(`  ${marca} ${caminho}`);
  };

  bloco('Preparado para commit', situacao.preparados.novos, 'novo:     ');
  bloco('Preparado para commit', situacao.preparados.modificados, 'alterado: ');
  bloco('Preparado para commit', situacao.preparados.removidos, 'removido: ');
  bloco('Alterado, não preparado', situacao.naoPreparados.modificados, 'alterado: ');
  bloco('Sumiu do disco, não preparado', situacao.naoPreparados.removidos, 'removido: ');
  bloco('Não rastreado', situacao.naoRastreados, '?');

  if (situacao.limpo) escrever('\nNada a fazer: trabalho limpo.');
}

/* c8 ignore start */
// Só roda sozinho quando foi chamado direto; importado num teste, fica quieto.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
/* c8 ignore stop */
