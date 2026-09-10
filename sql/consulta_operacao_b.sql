-- Operacao B: base propria de disparo, lida direto do cadastro de clientes.
--
-- Diferente da Operacao A, aqui nao ha cruzamento com o banco de mensagens: a
-- consulta ja devolve a lista final de telefones da operacao. Os campos tambem
-- tem nomes proprios (des_cpf, segmentacao, prioridade) em vez dos usados na A.
--
-- O nome sai de 'nome' (nao de 'nom_clien', que a Operacao A usa e que NAO
-- existe em nenhum registro da B — conferido no banco). Vem preenchido em 100%
-- dos registros e traz so o primeiro nome, ja capitalizado.
--
-- DUAS ETAPAS:
--
-- 1. Subconsulta: DISTINCT ON (phone_number) com desempate por created_at. A
--    tabela guarda o historico do cliente (ate 18 linhas para o mesmo telefone)
--    e ~19% dos telefones trocam de 'prioridade' ao longo do tempo. Sem o
--    desempate o Postgres escolheria uma linha qualquer e o mesmo cliente
--    cairia numa planilha diferente a cada execucao. Vence a linha mais
--    recente, que e o estado atual da divida.
--
-- 2. Consulta externa: ordena o resultado (um registro por telefone) por
--    created_at DESC. A deduplicacao por CPF acontece no Python
--    (contatos_b.py), que fica com a primeira ocorrencia de cada CPF — entao
--    precisa receber as linhas da mais recente para a mais antiga, para o
--    telefone mantido ser o do cadastro mais atual.
SELECT telefone, nome, cpf, bucket, rating
FROM (
    SELECT DISTINCT ON (attributes->'campos'->>'phone_number')
        attributes->'campos'->>'phone_number' AS telefone,
        attributes->'campos'->>'nome'         AS nome,
        attributes->'campos'->>'des_cpf'      AS cpf,
        attributes->'campos'->>'segmentacao'  AS bucket,
        attributes->'campos'->>'prioridade'   AS rating,
        created_at,
        id
    FROM public.customer
    WHERE attributes->'campos'->>'operacao' = 'B'
    ORDER BY
        attributes->'campos'->>'phone_number',
        created_at DESC,
        id DESC
) uniq
ORDER BY created_at DESC, id DESC;
