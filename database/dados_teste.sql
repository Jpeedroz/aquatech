-- ============================================================
-- AQUATECH - DADOS DE TESTE (OPCIONAL)
-- ============================================================
--
-- Não faz parte da estrutura do banco. Use só para ver telas e
-- gráficos no modo API sem o ESP32. Rode DEPOIS de
-- aquatech_database.sql (o Docker NÃO executa este arquivo):
--
--     python scripts/init_db.py --recriar --com-dados-teste
--
-- ATENÇÃO: 'senha_teste_hash' NÃO é um hash válido. Para entrar
-- com joao@example.com defina uma senha real:
--
--     python scripts/init_db.py --definir-senha-teste
--
-- ============================================================


-- ============================================================
-- 1. USUÁRIO DE TESTE
-- ============================================================
--
-- ATENÇÃO: 'senha_teste_hash' NÃO é um hash válido. Serve só
-- para preencher a coluna. Para testar o login de verdade, o
-- Flask deve gravar aqui um hash real (ex.: werkzeug).
--
-- ============================================================

INSERT INTO usuarios (
    nome,
    email,
    telefone,
    senha_hash
)
VALUES (
    'João Pereira',
    'joao@example.com',
    '(88) 99999-9999',
    'senha_teste_hash'
);


-- ============================================================
-- 2. PROPRIEDADE DE TESTE
-- ============================================================

INSERT INTO propriedades (
    usuario_id,
    nome,
    localizacao,
    area_hectares,
    cultura,
    metodo_irrigacao,
    limite_umidade,
    limite_umidade_desliga
)
VALUES (
    1,
    'Sítio Boa Vista',
    'Juazeiro do Norte - CE',
    2.00,
    'Cebola',
    'Bomba d''água',
    18.00,
    30.00
);


-- ============================================================
-- 3. ESP32 DE TESTE
-- ============================================================

INSERT INTO dispositivos (
    propriedade_id,
    codigo_dispositivo,
    nome,
    online,
    irrigacao_ligada,
    ultimo_sinal
)
VALUES (
    1,
    'ESP32-001',
    'ESP32 AquaTech',
    TRUE,
    FALSE,
    CURRENT_TIMESTAMP
);


-- ============================================================
-- 4. SENSORES DE TESTE
-- ============================================================

INSERT INTO sensores (
    dispositivo_id,
    tipo,
    nome,
    unidade
)
VALUES
(
    1,
    'umidade_solo',
    'Sensor de Umidade',
    '%'
),
(
    1,
    'temperatura',
    'Sensor de Temperatura',
    '°C'
),
(
    1,
    'vazao_agua',
    'Sensor de Vazão',
    'L/min'
);


-- ============================================================
-- 5. IRRIGAÇÕES DE TESTE (últimos 30 dias, valores fixos)
-- ============================================================
--
-- HOJE: 2 irrigações = 270 L
--   09:00 às 11:00 (120 min, 180 L, umidade 17% -> 30%)
--   13:00 às 14:00 ( 60 min,  90 L, umidade 18% -> 30%)
--
-- Últimos 6 dias antes de hoje: 130, 190, 220, 120, 190, 140 L
-- (somando com hoje: 1.260 L em 7 dias).
--
-- Dias anteriores: uma irrigação por dia às 09:00, com vazão
-- de 1,5 L/min, sem números aleatórios.
--
-- ============================================================

INSERT INTO eventos_irrigacao (
    dispositivo_id,
    iniciado_em,
    encerrado_em,
    duracao_minutos,
    agua_utilizada_litros,
    umidade_antes,
    umidade_depois
)
VALUES
(
    1,
    CURRENT_DATE + INTERVAL '9 hours',
    CURRENT_DATE + INTERVAL '11 hours',
    120,
    180,
    17,
    30
),
(
    1,
    CURRENT_DATE + INTERVAL '13 hours',
    CURRENT_DATE + INTERVAL '14 hours',
    60,
    90,
    18,
    30
);

INSERT INTO eventos_irrigacao (
    dispositivo_id,
    iniciado_em,
    encerrado_em,
    duracao_minutos,
    agua_utilizada_litros,
    umidade_antes,
    umidade_depois
)
SELECT
    1,
    dia + INTERVAL '9 hours',
    dia + INTERVAL '9 hours' + make_interval(mins => minutos),
    minutos,
    litros,
    17 + (n % 4),
    30
FROM (
    SELECT
        n,
        CURRENT_DATE - n AS dia,
        litros,
        ROUND(litros / 1.5)::INTEGER AS minutos
    FROM (
        SELECT
            n,
            CASE n
                WHEN 1 THEN 130
                WHEN 2 THEN 190
                WHEN 3 THEN 220
                WHEN 4 THEN 120
                WHEN 5 THEN 190
                WHEN 6 THEN 140
                ELSE 100 + ((n * 37) % 13) * 10
            END AS litros
        FROM generate_series(1, 29) AS n
    ) AS base
) AS dias;


-- ============================================================
-- 6. LEITURAS DE UMIDADE E TEMPERATURA DE TESTE
-- ============================================================
--
-- 8 leituras por dia (07:00 às 14:00), nos últimos 30 dias.
-- Hoje: valores fixos (umidade 25, 21, 17, 24, 30, 24, 18, 30).
-- Dias anteriores: os mesmos valores com pequena variação
-- calculada (sem RANDOM), para o teste ser sempre igual.
--
-- ============================================================

WITH base (k, hora, umid, temperatura) AS (
    VALUES
        (0,  7, 25, 27),
        (1,  8, 21, 28),
        (2,  9, 17, 29),
        (3, 10, 24, 29),
        (4, 11, 30, 28),
        (5, 12, 24, 32),
        (6, 13, 18, 33),
        (7, 14, 30, 28)
)
INSERT INTO leituras_sensores (
    sensor_id,
    valor,
    hora_leitura
)
SELECT
    1,
    LEAST(45, GREATEST(10,
        b.umid + CASE WHEN n = 0 THEN 0 ELSE ((n * 3 + b.k) % 5) - 2 END
    )),
    (CURRENT_DATE - n) + make_interval(hours => b.hora)
FROM base b
CROSS JOIN generate_series(0, 29) AS n

UNION ALL

SELECT
    2,
    b.temperatura + CASE WHEN n = 0 THEN 0 ELSE ((n + b.k) % 3) - 1 END,
    (CURRENT_DATE - n) + make_interval(hours => b.hora)
FROM base b
CROSS JOIN generate_series(0, 29) AS n;


-- ============================================================
-- 7. LEITURAS DE VAZÃO DE TESTE (hoje)
-- ============================================================
--
-- Durante a irrigação: 1,5 L/min. Fora dela: 0 L/min.
--
-- ============================================================

INSERT INTO leituras_sensores (
    sensor_id,
    valor,
    hora_leitura
)
VALUES
(3, 0,   CURRENT_DATE + INTERVAL '8 hours 30 minutes'),
(3, 1.50, CURRENT_DATE + INTERVAL '9 hours 15 minutes'),
(3, 1.50, CURRENT_DATE + INTERVAL '10 hours 15 minutes'),
(3, 0,   CURRENT_DATE + INTERVAL '11 hours 15 minutes'),
(3, 1.50, CURRENT_DATE + INTERVAL '13 hours 15 minutes'),
(3, 0,   CURRENT_DATE + INTERVAL '14 hours 15 minutes');
