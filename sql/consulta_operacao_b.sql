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
-- DISTINCT ON com desempate por created_at: a tabela guarda o historico do
-- cliente (ate 18 linhas para o mesmo telefone), e cerca de 19% dos telefones
-- aparecem com mais de uma 'prioridade' ao longo do tempo. Sem o desempate, o
-- Postgres escolheria uma linha qualquer e o mesmo cliente cairia numa planilha
-- diferente a cada execucao. Vence sempre a linha mais recente, que e o estado
-- atual da divida; o id entra so como criterio final de estabilidade.
SELECT DISTINCT ON (attributes->'campos'->>'phone_number')
    attributes->'campos'->>'phone_number' AS telefone,
    attributes->'campos'->>'nome'         AS nome,
    attributes->'campos'->>'des_cpf'      AS cpf,
    attributes->'campos'->>'segmentacao'  AS bucket,
    attributes->'campos'->>'prioridade'   AS rating
FROM public.customer
WHERE attributes->'campos'->>'operacao' = 'B'
ORDER BY
    attributes->'campos'->>'phone_number',
    created_at DESC,
    id DESC;
