// As duas telas do app, desenhadas à mão (o visual do Auto Edit, não o
// cinza do Windows): a JANELINHA de progresso no canto da tela e o INSTALADOR.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace AutoEditAbrir
{
    static class Tema
    {
        public static readonly Color Fundo = Color.FromArgb(12, 12, 16);
        public static readonly Color Cartao = Color.FromArgb(20, 20, 26);
        public static readonly Color Linha = Color.FromArgb(38, 38, 48);
        public static readonly Color Texto = Color.FromArgb(244, 244, 248);
        public static readonly Color Suave = Color.FromArgb(168, 168, 182);
        public static readonly Color Apagado = Color.FromArgb(110, 110, 124);
        public static readonly Color Violeta = Color.FromArgb(167, 139, 250);
        public static readonly Color Fucsia = Color.FromArgb(217, 70, 239);
        public static readonly Color Verde = Color.FromArgb(52, 211, 153);
        public static readonly Color Ambar = Color.FromArgb(251, 191, 36);
        public static readonly Color Vermelho = Color.FromArgb(248, 113, 113);
        public static readonly Color Lima = Color.FromArgb(200, 255, 0);

        public static GraphicsPath Arredondado(RectangleF r, float raio)
        {
            var p = new GraphicsPath();
            float d = raio * 2;
            p.AddArc(r.Left, r.Top, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Top, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static void Qualidade(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        }

        /// <summary>O ícone do editor: CapCut (preto, a tesoura) ou Premiere (azul, "Pr").</summary>
        public static void Logo(Graphics g, RectangleF r, string alvo)
        {
            float raio = r.Width * 0.23f;
            using (var path = Arredondado(r, raio))
            {
                if (alvo == "premiere")
                {
                    using (var b = new SolidBrush(Color.FromArgb(0, 0, 91))) g.FillPath(b, path);
                    using (var pen = new Pen(Color.FromArgb(153, 153, 255), r.Width * 0.04f))
                    using (var dentro = Arredondado(RectangleF.Inflate(r, -r.Width * 0.06f, -r.Width * 0.06f), raio * 0.8f)) g.DrawPath(pen, dentro);
                    using (var f = new Font("Segoe UI", r.Width * 0.30f, FontStyle.Bold, GraphicsUnit.Pixel))
                    using (var b = new SolidBrush(Color.FromArgb(153, 153, 255)))
                    {
                        var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                        g.DrawString("Pr", f, b, r, fmt);
                    }
                    return;
                }
                if (alvo == "capcut")
                {
                    // o símbolo OFICIAL (medido no Resources/logo_cc.png do próprio
                    // CapCut, espaço 240x240 — o MESMO desenho do LogoCapCut do site)
                    using (var b = new SolidBrush(Color.Black)) g.FillPath(b, path);
                    using (var pen = new Pen(Color.FromArgb(40, 255, 255, 255), 1f)) g.DrawPath(pen, path);
                    float s = r.Width / 240f;
                    Func<float, float, PointF> P = (x, y) => new PointF(r.Left + x * s, r.Top + y * s);
                    using (var b = new SolidBrush(Color.White))
                    {
                        using (var barra = Arredondado(new RectangleF(r.Left + 43 * s, r.Top + 57 * s, 129 * s, 23.5f * s), 11.75f * s)) g.FillPath(b, barra);
                        using (var barra = Arredondado(new RectangleF(r.Left + 43 * s, r.Top + 159.5f * s, 129 * s, 23.5f * s), 11.75f * s)) g.FillPath(b, barra);
                        g.FillPolygon(b, new[] { P(43, 73.25f), P(202.5f, 156.05f), P(202.5f, 181.15f), P(43, 98.35f) });
                        g.FillPolygon(b, new[] { P(43, 166.75f), P(202.5f, 83.95f), P(202.5f, 58.85f), P(43, 141.65f) });
                    }
                    return;
                }
                // o app: gradiente violeta → fúcsia com um "play"
                using (var b = new LinearGradientBrush(r, Violeta, Fucsia, 45f)) g.FillPath(b, path);
                float cx = r.Left + r.Width * 0.53f, cy = r.Top + r.Height / 2, t = r.Width * 0.22f;
                using (var b = new SolidBrush(Color.White))
                    g.FillPolygon(b, new[] { new PointF(cx - t * 0.8f, cy - t), new PointF(cx + t, cy), new PointF(cx - t * 0.8f, cy + t) });
            }
        }
    }

    /* ═══════════════════════ janelinha de progresso ═══════════════════════ */

    sealed class Janelinha : Form
    {
        public enum Estado { Trabalhando, Pronto, Aviso, Erro }

        readonly string alvo;
        readonly float S;
        string titulo = "", detalhe = "";
        Estado estado = Estado.Trabalhando;
        float fase;
        readonly Timer anima;
        readonly List<KeyValuePair<string, Action>> botoes = new List<KeyValuePair<string, Action>>();
        readonly List<RectangleF> areaBotoes = new List<RectangleF>();
        RectangleF areaX;
        int sobre = -2;
        public volatile bool Cancelado;
        DateTime fecharEm = DateTime.MaxValue;
        bool emCima;

        public Janelinha(string alvo)
        {
            this.alvo = alvo;
            using (var g = CreateGraphics()) S = g.DpiX / 96f;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Tema.Fundo;
            DoubleBuffered = true;
            Text = Instalador.NomeDoApp;
            ClientSize = new Size((int)(392 * S), (int)(132 * S));
            Posicionar();
            anima = new Timer { Interval = 33 };
            anima.Tick += delegate
            {
                fase = (fase + 0.018f) % 1f;
                if (DateTime.UtcNow >= fecharEm && sobre == -2) Close();
                Invalidate();
            };
            anima.Start();
            MouseMove += delegate (object o, MouseEventArgs e) { int s = Alvo(e.Location); if (s != sobre) { sobre = s; Cursor = s >= -1 ? Cursors.Hand : Cursors.Default; Invalidate(); } };
            MouseLeave += delegate { sobre = -2; Cursor = Cursors.Default; Invalidate(); };
            MouseClick += delegate (object o, MouseEventArgs e)
            {
                int s = Alvo(e.Location);
                if (s == -1) { Cancelado = true; Close(); }
                else if (s >= 0 && s < botoes.Count) { try { botoes[s].Value(); } catch { } }
            };
            Region = new Region(Tema.Arredondado(new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), 14 * S));
        }

        void Posicionar()
        {
            Rectangle area = Screen.FromPoint(Cursor.Position).WorkingArea;
            int m = (int)(18 * S);
            Location = emCima
                ? new Point(area.Right - Width - m, area.Top + m)
                : new Point(area.Right - Width - m, area.Bottom - Height - m);
        }

        /// <summary>Sai da frente de um ponto da tela (o clique na capa não pode cair aqui).</summary>
        public void SairDaFrente(Point p)
        {
            if (!IsHandleCreated) return;
            BeginInvoke((Action)delegate
            {
                if (!Bounds.Contains(p)) return;
                emCima = !emCima;
                Posicionar();
            });
        }

        public Rectangle Area { get { return Bounds; } }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x00000080 | 0x08000000 | 0x00000008; // TOOLWINDOW | NOACTIVATE | TOPMOST
                return cp;
            }
        }

        int Alvo(Point p)
        {
            if (areaX.Contains(p)) return -1;
            for (int i = 0; i < areaBotoes.Count; i++) if (areaBotoes[i].Contains(p)) return i;
            return -3;
        }

        void Mudar(Estado e, string t, string d, KeyValuePair<string, Action>[] bs, int fecharSeg)
        {
            if (!IsHandleCreated) return;
            BeginInvoke((Action)delegate
            {
                estado = e;
                titulo = t ?? "";
                detalhe = d ?? "";
                botoes.Clear();
                if (bs != null) botoes.AddRange(bs);
                int alturaBase = botoes.Count > 0 ? 168 : 132;
                if (ClientSize.Height != (int)(alturaBase * S))
                {
                    ClientSize = new Size(ClientSize.Width, (int)(alturaBase * S));
                    Region = new Region(Tema.Arredondado(new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), 14 * S));
                    Posicionar();
                }
                fecharEm = fecharSeg > 0 ? DateTime.UtcNow.AddSeconds(fecharSeg) : DateTime.MaxValue;
                Invalidate();
            });
        }

        public void Etapa(string t, string d) { Mudar(Estado.Trabalhando, t, d, null, 0); }
        public void Pronto(string t, string d, params KeyValuePair<string, Action>[] bs) { Mudar(Estado.Pronto, t, d, bs, bs.Length > 0 ? 25 : 8); }
        public void Aviso(string t, string d, params KeyValuePair<string, Action>[] bs) { Mudar(Estado.Aviso, t, d, bs, 0); }
        public void Erro(string t, string d, params KeyValuePair<string, Action>[] bs) { Mudar(Estado.Erro, t, d, bs, 0); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Tema.Qualidade(g);
            float W = ClientSize.Width, H = ClientSize.Height;
            var fundo = new RectangleF(0, 0, W - 1, H - 1);
            using (var b = new SolidBrush(Tema.Fundo)) g.FillRectangle(b, 0, 0, W, H);
            using (var path = Tema.Arredondado(fundo, 14 * S))
            using (var pen = new Pen(Tema.Linha, 1)) g.DrawPath(pen, path);
            // faixa de cor no topo
            using (var b = new LinearGradientBrush(new RectangleF(0, 0, W, 3 * S), Tema.Violeta, Tema.Fucsia, 0f)) g.FillRectangle(b, 0, 0, W, 3 * S);

            float m = 18 * S;
            var logo = new RectangleF(m, 22 * S, 42 * S, 42 * S);
            Tema.Logo(g, logo, alvo);
            // selo do estado no canto do logo
            if (estado != Estado.Trabalhando)
            {
                Color cor = estado == Estado.Pronto ? Tema.Verde : estado == Estado.Aviso ? Tema.Ambar : Tema.Vermelho;
                var selo = new RectangleF(logo.Right - 13 * S, logo.Bottom - 13 * S, 18 * S, 18 * S);
                using (var b = new SolidBrush(cor)) g.FillEllipse(b, selo);
                using (var pen = new Pen(Tema.Fundo, 2 * S)) g.DrawEllipse(pen, selo);
                using (var pen = new Pen(Tema.Fundo, 2.2f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                {
                    float cx = selo.Left + selo.Width / 2, cy = selo.Top + selo.Height / 2, k = 4 * S;
                    if (estado == Estado.Pronto) g.DrawLines(pen, new[] { new PointF(cx - k, cy), new PointF(cx - k * 0.2f, cy + k * 0.8f), new PointF(cx + k, cy - k * 0.7f) });
                    else { g.DrawLine(pen, cx, cy - k, cx, cy + k * 0.2f); g.DrawLine(pen, cx, cy + k * 0.85f, cx, cy + k * 0.9f); }
                }
            }

            float x0 = logo.Right + 14 * S, larg = W - x0 - 40 * S;
            using (var ft = new Font("Segoe UI Semibold", 10.5f))
            using (var b = new SolidBrush(Tema.Texto))
                g.DrawString(titulo, ft, b, new RectangleF(x0, 20 * S, larg, 24 * S), new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap });
            using (var fd = new Font("Segoe UI", 8.75f))
            using (var b = new SolidBrush(Tema.Suave))
                g.DrawString(detalhe, fd, b, new RectangleF(x0, 44 * S, larg + 22 * S, 52 * S), new StringFormat { Trimming = StringTrimming.EllipsisWord });

            // X de fechar
            areaX = new RectangleF(W - 34 * S, 12 * S, 22 * S, 22 * S);
            using (var pen = new Pen(sobre == -1 ? Tema.Texto : Tema.Apagado, 1.6f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                float k = 5 * S, cx = areaX.Left + areaX.Width / 2, cy = areaX.Top + areaX.Height / 2;
                g.DrawLine(pen, cx - k, cy - k, cx + k, cy + k);
                g.DrawLine(pen, cx + k, cy - k, cx - k, cy + k);
            }

            // barra: corre enquanto trabalha; cheia e colorida no fim
            var trilho = new RectangleF(m, 104 * S, W - 2 * m, 4 * S);
            using (var path = Tema.Arredondado(trilho, 2 * S))
            using (var b = new SolidBrush(Color.FromArgb(34, 34, 44))) g.FillPath(b, path);
            if (estado == Estado.Trabalhando)
            {
                float w = trilho.Width * 0.32f;
                float x = trilho.Left - w + (trilho.Width + w) * fase;
                var faixa = RectangleF.Intersect(new RectangleF(x, trilho.Top, w, trilho.Height), trilho);
                if (faixa.Width > 1)
                    using (var path = Tema.Arredondado(faixa, 2 * S))
                    using (var b = new LinearGradientBrush(new RectangleF(x - 1, trilho.Top, w + 2, trilho.Height), Tema.Violeta, Tema.Fucsia, 0f)) g.FillPath(b, path);
            }
            else
            {
                Color cor = estado == Estado.Pronto ? Tema.Verde : estado == Estado.Aviso ? Tema.Ambar : Tema.Vermelho;
                using (var path = Tema.Arredondado(trilho, 2 * S))
                using (var b = new SolidBrush(cor)) g.FillPath(b, path);
            }

            // botões
            areaBotoes.Clear();
            float bx = m;
            using (var fb = new Font("Segoe UI Semibold", 8.75f))
            {
                for (int i = 0; i < botoes.Count; i++)
                {
                    SizeF tam = g.MeasureString(botoes[i].Key, fb);
                    var r = new RectangleF(bx, 122 * S, tam.Width + 26 * S, 30 * S);
                    areaBotoes.Add(r);
                    using (var path = Tema.Arredondado(r, 8 * S))
                    {
                        using (var b = new SolidBrush(sobre == i ? Color.FromArgb(44, 44, 56) : Color.FromArgb(30, 30, 38))) g.FillPath(b, path);
                        using (var pen = new Pen(i == 0 ? Color.FromArgb(120, 167, 139, 250) : Tema.Linha, 1)) g.DrawPath(pen, path);
                    }
                    using (var b = new SolidBrush(Tema.Texto))
                        g.DrawString(botoes[i].Key, fb, b, r, new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
                    bx = r.Right + 8 * S;
                }
            }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            anima.Stop();
            base.OnFormClosed(e);
        }
    }

    /* ═══════════════════════════ instalador ═══════════════════════════ */

    sealed class TelaInstalador : Form
    {
        readonly float S;
        enum Fase { Inicio, Instalando, Pronto, Removido, Erro }
        Fase fase = Fase.Inicio;
        string erro = "";
        readonly string versaoInstalada;
        readonly string capcutExe, capcutRaiz, premiereExe;
        readonly List<KeyValuePair<RectangleF, Action>> cliques = new List<KeyValuePair<RectangleF, Action>>();
        int sobre = -1;

        public TelaInstalador()
        {
            using (var g = CreateGraphics()) S = g.DpiX / 96f;
            versaoInstalada = Instalador.VersaoInstalada();
            capcutExe = Capcut.Executavel();
            capcutRaiz = Capcut.PastaDosRascunhos();
            premiereExe = Premiere.Executavel();
            Text = Instalador.NomeDoApp;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Tema.Fundo;
            DoubleBuffered = true;
            ClientSize = new Size((int)(560 * S), (int)(430 * S));
            Region = new Region(Tema.Arredondado(new RectangleF(0, 0, ClientSize.Width, ClientSize.Height), 18 * S));
            try { Icon = Icon.ExtractAssociatedIcon(System.Reflection.Assembly.GetExecutingAssembly().Location); } catch { }
            MouseDown += delegate (object o, MouseEventArgs e)
            {
                // arrastar pela faixa de cima
                if (e.Button == MouseButtons.Left && e.Y < 70 * S && Indice(e.Location) < 0) { Capture = false; var m = Message.Create(Handle, 0xA1, new IntPtr(2), IntPtr.Zero); WndProc(ref m); }
            };
            MouseMove += delegate (object o, MouseEventArgs e) { int i = Indice(e.Location); if (i != sobre) { sobre = i; Cursor = i >= 0 ? Cursors.Hand : Cursors.Default; Invalidate(); } };
            MouseClick += delegate (object o, MouseEventArgs e) { int i = Indice(e.Location); if (i >= 0) cliques[i].Value(); };
            KeyPreview = true;
            KeyDown += delegate (object o, KeyEventArgs e) { if (e.KeyCode == Keys.Escape && fase != Fase.Instalando) Close(); };
        }

        int Indice(Point p)
        {
            for (int i = 0; i < cliques.Count; i++) if (cliques[i].Key.Contains(p)) return i;
            return -1;
        }

        void Instalar()
        {
            fase = Fase.Instalando;
            Invalidate();
            Update();
            try
            {
                Instalador.Instalar();
                fase = Fase.Pronto;
                Instalador.AbrirNoNavegador(Instalador.SiteInstalado + Instalador.Versao);
            }
            catch (Exception ex)
            {
                Log.Escrever("instalação falhou: " + ex);
                erro = ex.Message;
                fase = Fase.Erro;
            }
            Invalidate();
        }

        void Desinstalar()
        {
            Instalador.Desinstalar();
            if (System.IO.Directory.Exists(Instalador.PastaDoApp)) Instalador.AgendarLimpezaDaPasta();
            fase = Fase.Removido;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            Tema.Qualidade(g);
            cliques.Clear();
            float W = ClientSize.Width, H = ClientSize.Height, m = 32 * S;
            using (var b = new SolidBrush(Tema.Fundo)) g.FillRectangle(b, 0, 0, W, H);
            // brilho violeta no alto
            using (var path = new GraphicsPath())
            {
                path.AddEllipse(-W * 0.2f, -H * 0.55f, W * 1.4f, H * 0.9f);
                using (var b = new PathGradientBrush(path) { CenterColor = Color.FromArgb(46, 167, 139, 250), SurroundColors = new[] { Color.FromArgb(0, 12, 12, 16) } })
                    g.FillPath(b, path);
            }
            using (var path = Tema.Arredondado(new RectangleF(0, 0, W - 1, H - 1), 18 * S))
            using (var pen = new Pen(Tema.Linha, 1)) g.DrawPath(pen, path);
            using (var b = new LinearGradientBrush(new RectangleF(0, 0, W, 3 * S), Tema.Violeta, Tema.Fucsia, 0f)) g.FillRectangle(b, 0, 0, W, 3 * S);

            // fechar
            var rx = new RectangleF(W - 44 * S, 16 * S, 28 * S, 28 * S);
            if (fase != Fase.Instalando) cliques.Add(new KeyValuePair<RectangleF, Action>(rx, Close));
            using (var pen = new Pen(sobre == cliques.Count - 1 && fase != Fase.Instalando ? Tema.Texto : Tema.Apagado, 1.8f * S) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                float k = 6 * S, cx = rx.Left + rx.Width / 2, cy = rx.Top + rx.Height / 2;
                g.DrawLine(pen, cx - k, cy - k, cx + k, cy + k);
                g.DrawLine(pen, cx + k, cy - k, cx - k, cy + k);
            }

            Tema.Logo(g, new RectangleF(m, 34 * S, 54 * S, 54 * S), "app");
            using (var f = new Font("Segoe UI Semibold", 17f))
            using (var b = new SolidBrush(Tema.Texto)) g.DrawString(Instalador.NomeDoApp, f, b, m + 70 * S, 36 * S);
            using (var f = new Font("Segoe UI", 9f))
            using (var b = new SolidBrush(Tema.Apagado)) g.DrawString("versão " + Instalador.Versao + "  ·  Auto Edit", f, b, m + 72 * S, 68 * S);

            float y = 116 * S;
            var fTexto = new Font("Segoe UI", 10f);
            var bSuave = new SolidBrush(Tema.Suave);
            string corpo;
            if (fase == Fase.Pronto)
                corpo = "Pronto! Agora o botão \"Projeto editável\" do Pilot abre o projeto direto no editor.\n\nNa 1ª vez o Chrome pergunta \"Abrir Auto Edit Abrir?\": marque \"Sempre permitir\" e clique em Abrir.";
            else if (fase == Fase.Removido)
                corpo = "O Auto Edit Abrir foi removido deste PC. O botão \"Projeto editável\" continua baixando o .zip com o PDF de como abrir.";
            else if (fase == Fase.Erro)
                corpo = "Não deu pra instalar: " + erro;
            else
                corpo = "Com ele, o botão \"Projeto editável\" do Pilot abre o projeto direto no CapCut ou no Premiere — sem extrair zip, sem procurar pasta. Ele só roda quando você clica no Pilot: não fica ligado nem inicia com o Windows.";
            g.DrawString(corpo, fTexto, bSuave, new RectangleF(m, y, W - 2 * m, 96 * S));
            y += 104 * S;

            // o que ele achou neste PC
            if (fase == Fase.Inicio || fase == Fase.Pronto)
            {
                Linha(g, ref y, W, m, capcutExe != null, "CapCut", capcutExe != null ? "projetos vão para " + capcutRaiz : "não encontrado — instale o CapCut pra abrir por aqui");
                Linha(g, ref y, W, m, premiereExe != null, "Premiere Pro", premiereExe != null ? "encontrado — o projeto vai para C:\\AUTOEDIT" : "não encontrado (opcional)");
            }
            fTexto.Dispose();
            bSuave.Dispose();

            // botões
            float by = H - 66 * S;
            if (fase == Fase.Inicio)
            {
                string principal = versaoInstalada == null ? "Instalar" : (versaoInstalada == Instalador.Versao ? "Reinstalar" : "Atualizar para " + Instalador.Versao);
                Botao(g, new RectangleF(m, by, 170 * S, 40 * S), principal, true, Instalar);
                if (versaoInstalada != null) Botao(g, new RectangleF(m + 182 * S, by, 130 * S, 40 * S), "Desinstalar", false, Desinstalar);
            }
            else if (fase == Fase.Instalando)
            {
                using (var f = new Font("Segoe UI", 10f))
                using (var b = new SolidBrush(Tema.Texto)) g.DrawString("Instalando…", f, b, m, by + 10 * S);
            }
            else if (fase == Fase.Pronto)
            {
                Botao(g, new RectangleF(m, by, 170 * S, 40 * S), "Concluir", true, Close);
                Botao(g, new RectangleF(m + 182 * S, by, 170 * S, 40 * S), "Abrir o Auto Edit", false, delegate { Instalador.AbrirNoNavegador(Instalador.SiteInstalado + Instalador.Versao); });
            }
            else
            {
                Botao(g, new RectangleF(m, by, 170 * S, 40 * S), "Fechar", true, Close);
            }
        }

        void Linha(Graphics g, ref float y, float W, float m, bool ok, string nome, string texto)
        {
            var r = new RectangleF(m, y, W - 2 * m, 40 * S);
            using (var path = Tema.Arredondado(r, 10 * S))
            using (var b = new SolidBrush(Tema.Cartao)) g.FillPath(b, path);
            var bola = new RectangleF(r.Left + 14 * S, r.Top + 13 * S, 14 * S, 14 * S);
            using (var b = new SolidBrush(ok ? Tema.Verde : Tema.Apagado)) g.FillEllipse(b, bola);
            using (var f = new Font("Segoe UI Semibold", 9.5f))
            using (var b = new SolidBrush(Tema.Texto)) g.DrawString(nome, f, b, r.Left + 38 * S, r.Top + 10 * S);
            using (var f = new Font("Segoe UI", 8.75f))
            using (var b = new SolidBrush(Tema.Suave))
                g.DrawString(texto, f, b, new RectangleF(r.Left + 140 * S, r.Top + 11 * S, r.Width - 150 * S, 20 * S), new StringFormat { Trimming = StringTrimming.EllipsisPath, FormatFlags = StringFormatFlags.NoWrap });
            y += 48 * S;
        }

        void Botao(Graphics g, RectangleF r, string texto, bool principal, Action acao)
        {
            cliques.Add(new KeyValuePair<RectangleF, Action>(r, acao));
            bool hover = sobre == cliques.Count - 1;
            using (var path = Tema.Arredondado(r, 11 * S))
            {
                if (principal)
                    using (var b = new LinearGradientBrush(r, hover ? Color.FromArgb(186, 160, 255) : Tema.Violeta, hover ? Color.FromArgb(232, 110, 250) : Tema.Fucsia, 0f)) g.FillPath(b, path);
                else
                {
                    using (var b = new SolidBrush(hover ? Color.FromArgb(40, 40, 52) : Tema.Cartao)) g.FillPath(b, path);
                    using (var pen = new Pen(Tema.Linha, 1)) g.DrawPath(pen, path);
                }
            }
            using (var f = new Font("Segoe UI Semibold", 10f))
            using (var b = new SolidBrush(principal ? Color.White : Tema.Texto))
                g.DrawString(texto, f, b, r, new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
        }
    }
}
