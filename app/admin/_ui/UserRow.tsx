'use client';

import { memo, useState } from 'react';
import { Avatar, I, IconOnly, Menu, MenuItem, MenuSep, NestedBtn, Segmented, Tag } from './kit';
import {
  ACCESS_META,
  CATALOG_LABEL,
  accent,
  betaProTools,
  fmtDate,
  fmtPhone,
  initials,
  isOnline,
  isUsingTool,
  timeAgo,
  toolLabel,
  type AdminUser,
} from './model';

export type RowActions = {
  open: (u: AdminUser, tab?: 'geral' | 'acessos') => void;
  plan: (u: AdminUser, plan: 'free' | 'premium') => void;
  beta: (u: AdminUser) => void;
  reset: (u: AdminUser) => void;
  toggle: (u: AdminUser) => void;
  remove: (u: AdminUser) => void;
  reconcile: (u: AdminUser) => void;
};

/**
 * Uma linha da lista de clientes. Memo: só re-renderiza quando o usuário
 * muda, quando vira o relógio do poll (`now`) ou quando fica ocupado.
 * content-visibility pula o desenho das linhas fora da tela.
 */
export const UserRow = memo(function UserRow({
  u,
  now,
  busy,
  actions,
}: {
  u: AdminUser;
  now: number;
  busy: boolean;
  actions: RowActions;
}) {
  const [menuAt, setMenuAt] = useState<HTMLElement | null>(null);
  const online = isOnline(u, now);
  const meta = ACCESS_META[u.access];
  const beta = betaProTools(u);
  const usingNow = isUsingTool(u, now);
  const tLabel = toolLabel(u.last_tool);
  const phone = fmtPhone(u.phone);
  const concurrent = u.concurrent_30d ?? 0;
  const premiumTone = u.access === 'paid' ? 'lime' : 'cyan';

  return (
    <li
      className={'group/row relative transition-colors duration-200 hover:bg-[rgb(var(--text)/0.025)] ' + (u.is_active ? '' : 'opacity-60')}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 84px' }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 md:px-5">
        {/* Identidade → abre o perfil */}
        <button
          type="button"
          onClick={() => actions.open(u)}
          className="flex min-w-0 flex-1 basis-[300px] items-center gap-3.5 text-left"
          title="Abrir perfil completo"
        >
          <Avatar text={initials(u.name, u.email)} a={meta.accent} online={online} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-text">
                {u.name || 'Sem nome'}
              </span>
              <Tag a={meta.accent}>{meta.short}</Tag>
              {beta.length > 0 ? (
                <Tag a="violet" title={beta.map((p) => CATALOG_LABEL.get(p) ?? p).join(', ')}>
                  <I.bolt size={11} /> Beta Pro {beta.length}
                </Tag>
              ) : null}
              {concurrent > 0 ? (
                <Tag a="danger" title={`Último: ${fmtDate(u.concurrent_last_at) ?? ''}`}>
                  <I.alert size={11} /> {concurrent === 1 ? 'Acesso simultâneo' : `${concurrent} acessos simultâneos`}
                </Tag>
              ) : null}
              {!u.is_active ? <Tag a="danger">Desativado</Tag> : null}
              {u.must_change_password ? <Tag a="amber">Senha provisória</Tag> : null}
            </span>
            <span className="field-label mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-text-muted">
              <span className="truncate">{u.email || 'Sem email'}</span>
              {phone ? (
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <I.phone size={12} />
                  {phone}
                </span>
              ) : null}
            </span>
            <span className="field-label mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-text-muted">
              {usingNow && tLabel ? (
                <span className="whitespace-nowrap font-semibold" style={{ color: accent('lime') }}>
                  Usando {tLabel} agora
                </span>
              ) : u.last_seen_at ? (
                <span className="whitespace-nowrap">
                  Visto {timeAgo(u.last_seen_at, now)}
                  {tLabel ? ` · ${tLabel}` : ''}
                </span>
              ) : (
                <span className="whitespace-nowrap">Nunca entrou</span>
              )}
              {u.last_ip ? <span className="mono whitespace-nowrap text-[11.5px]">{u.last_ip}</span> : null}
            </span>
          </span>
        </button>

        {/* Ações */}
        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            size="sm"
            value={u.plan}
            disabled={busy}
            onChange={(p) => actions.plan(u, p)}
            options={[
              { value: 'free', label: 'Free', title: 'Rebaixar pra Free (pede confirmação)', tone: 'neutral' },
              { value: 'premium', label: 'Premium', title: 'Liberar Premium na mão (não expira)', tone: premiumTone },
            ]}
          />
          <NestedBtn onClick={() => actions.open(u)} icon={<I.arrow size={12} />} title="Perfil completo">
            Perfil
          </NestedBtn>
          <IconOnly title="Mais ações" onClick={(e) => setMenuAt(menuAt ? null : e.currentTarget)} disabled={busy}>
            <I.dots size={16} />
          </IconOnly>
        </div>
      </div>

      {menuAt ? (
        <Menu anchor={menuAt} onClose={() => setMenuAt(null)} width={256}>
          <MenuItem icon={<I.bolt size={14} />} tone="violet" onClick={() => { setMenuAt(null); actions.beta(u); }} hint="Ferramentas internas só pra esta conta">
            Beta Pro
          </MenuItem>
          {u.receipt_url ? (
            <MenuItem icon={<I.receipt size={14} />} href={u.receipt_url} hint={u.last_payment_at ? `Pagamento de ${fmtDate(u.last_payment_at)}` : undefined}>
              Abrir comprovante
            </MenuItem>
          ) : null}
          <MenuItem icon={<I.key size={14} />} onClick={() => { setMenuAt(null); actions.reset(u); }}>
            Gerar senha provisória
          </MenuItem>
          <MenuItem icon={<I.sync size={14} />} onClick={() => { setMenuAt(null); actions.reconcile(u); }} hint="Lê o Stripe e aplica o plano real">
            Sincronizar com o Stripe
          </MenuItem>
          <MenuItem icon={<I.globe size={14} />} onClick={() => { setMenuAt(null); actions.open(u, 'acessos'); }}>
            Histórico de IPs
          </MenuItem>
          <MenuSep />
          <MenuItem icon={<I.power size={14} />} onClick={() => { setMenuAt(null); actions.toggle(u); }}>
            {u.is_active ? 'Desativar conta' : 'Reativar conta'}
          </MenuItem>
          <MenuItem icon={<I.trash size={14} />} tone="danger" onClick={() => { setMenuAt(null); actions.remove(u); }}>
            Deletar usuário
          </MenuItem>
        </Menu>
      ) : null}
    </li>
  );
});
