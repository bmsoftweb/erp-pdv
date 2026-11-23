-- Clube de descontos do PDV (banco bmerp_*)
-- Associado: marca clube_desconto no cadastro de pessoas (como o Desconto_Fidelidade do sistema Delphi).
-- Promoções do clube: listas de preço do erp-estoque (tela Preços) com o critério "clube" — vigência, preço fixo ou %
-- por produto/variante/marca/categoria. O PDV aplica as listas do clube em vigor quando o CPF da venda é de um associado.

ALTER TABLE cad_pessoas
  ADD COLUMN clube_desconto TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = associado do clube de descontos do PDV';

ALTER TABLE pre_lista_criterios
  MODIFY COLUMN campo ENUM('tipo_cliente','cidade','uf','regiao','vendedor','cliente','canal','clube') NOT NULL;

-- Reversão:
-- DELETE FROM pre_lista_criterios WHERE campo = 'clube';
-- ALTER TABLE pre_lista_criterios MODIFY COLUMN campo ENUM('tipo_cliente','cidade','uf','regiao','vendedor','cliente','canal') NOT NULL;
-- ALTER TABLE cad_pessoas DROP COLUMN clube_desconto;
