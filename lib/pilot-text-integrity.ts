export type PilotTextPart = {
  label?: string | null;
  text?: string | null;
};

export type PilotTextIntegrityIssue = {
  index: number;
  label: string;
  reason: 'scene-plan-json';
};

/**
 * Detecta quando um JSON de plano de cenas foi colado acidentalmente dentro
 * de uma fala. O teste combina chaves de AD com os campos exclusivos do plano
 * para não bloquear copy comum que use chaves ou exemplos em JSON.
 */
export function hasScenePlanJsonLeak(text: string | null | undefined): boolean {
  const value = String(text ?? '').trim();
  if (!value.includes('"avatarId"') || !value.includes('"voiceId"')) return false;

  const hasAdMap = /"AD\d+[A-Z0-9_-]*"\s*:\s*\[/i.test(value);
  const hasSceneShape = /"cena"\s*:\s*"/i.test(value) && /"motor"\s*:\s*"(?:III|IV|V)"/i.test(value);
  return hasAdMap && hasSceneShape;
}

export function findPilotTextIntegrityIssue(parts: PilotTextPart[]): PilotTextIntegrityIssue | null {
  for (let index = 0; index < parts.length; index += 1) {
    if (hasScenePlanJsonLeak(parts[index]?.text)) {
      return {
        index,
        label: String(parts[index]?.label || `parte ${index + 1}`),
        reason: 'scene-plan-json',
      };
    }
  }
  return null;
}
