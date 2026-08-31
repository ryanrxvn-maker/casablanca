'use client';

/**
 * PREVIEW DEV-ONLY (31.08): a AUDITORIA de export do FakePass fora do login.
 * Mesma página de /tools/fakepass/audit — roda o pipeline REAL de export em
 * todos os modelos e mede o alinhamento. Fora do dev responde 404.
 */

export { default } from '../../tools/fakepass/audit/page';
