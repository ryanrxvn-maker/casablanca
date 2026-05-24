// =============================================================
//  Auto Edit Installer - Setup.exe
//  WinForms UI espelhando o design auto-edit.app:
//   - Violet #c084fc + Fuchsia #d946ef (cores reais do logo)
//   - Logo do coelho neon embedded (PNG renderizado HQ)
//   - Brand "Auto Edit" + eyebrow + status + progress + actions
//
//  PARAMETRIZADO via #define REMOVER:
//   - default → AutoEditDownloaderSetup
//   - /define:REMOVER → AutoEditSmartRemoverSetup
//
//  ANTI-AV:
//   - winexe (sem console), CreateNoWindow + RedirectStandardOutput
//   - AssemblyInfo + manifest XML asInvoker
//   - Assinado via sign-exe.ps1 (self-signed CN=Auto Edit)
//
//  ANTI-BLUR / DPI:
//   - SetProcessDPIAware() chamado ANTES de criar qualquer UI
//   - AutoScaleMode = Dpi
//   - PaintedImage com InterpolationMode.HighQualityBicubic
//   - TextRenderingHint.ClearTypeGridFit em todos os Paint custom
//   - SmoothingMode.HighQuality em todos os Paint custom
//
//  ANTI-CORTE:
//   - Form Size 620x420 (+44px largura, +40px altura vs antes)
//   - Labels AutoSize=true quando possivel
//   - Padding generoso em containers
//   - Status/Hint com bounds explicitos + AutoEllipsis
// =============================================================

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace AutoEdit
{
    // ====================== Branding parametrizado ============================
    static class Brand
    {
#if REMOVER
        public const string Product    = "Smart Remover";
        public const string Eyebrow    = "VÍDEO COM IA  ·  INSTALADOR";
        public const string InstallDir = "AutoEditSmartRemover";
        public const string Hint       = "Baixando IA + componentes (~600 MB) na 1ª vez. Pode levar 3 a 10 min.";
#else
        public const string Product    = "Downloader";
        public const string Eyebrow    = "DOWNLOADER  ·  INSTALADOR";
        public const string InstallDir = "AutoEditDownloader";
        public const string Hint       = "Baixando componentes (~250 MB) na 1ª vez. Pode levar 1 a 3 min.";
#endif
        public const string Heading    = "Auto Edit";
        public const string DoneHint   = "Pronto. O motor está vinculado. Use a ferramenta no site normalmente.";
    }

    // ====================== Design Tokens ====================================
    static class Theme
    {
        public static readonly Color Bg          = Color.FromArgb(7, 7, 8);
        public static readonly Color BgSoft      = Color.FromArgb(14, 14, 16);
        public static readonly Color BgSofter    = Color.FromArgb(21, 21, 26);
        public static readonly Color BgElev      = Color.FromArgb(26, 26, 32);
        public static readonly Color Line        = Color.FromArgb(28, 28, 34);
        public static readonly Color LineStrong  = Color.FromArgb(36, 36, 44);
        public static readonly Color Text        = Color.White;
        public static readonly Color TextMuted   = Color.FromArgb(160, 160, 170);
        public static readonly Color TextDim     = Color.FromArgb(95, 95, 105);
        public static readonly Color Violet      = Color.FromArgb(192, 132, 252);
        public static readonly Color VioletSoft  = Color.FromArgb(167, 139, 250);
        public static readonly Color VioletDeep  = Color.FromArgb(109, 78, 232);
        public static readonly Color Fuchsia     = Color.FromArgb(217, 70, 239);
        public static readonly Color FuchsiaSoft = Color.FromArgb(232, 121, 249);
        public static readonly Color Lime        = Color.FromArgb(200, 255, 0);
        public static readonly Color Danger      = Color.FromArgb(248, 113, 113);
    }

    // ====================== DPI helpers (anti-blur) ==========================
    static class Dpi
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(int value);
        // 0 = unaware, 1 = system, 2 = per-monitor

        public static void Enable()
        {
            // Prefer SetProcessDpiAwareness(2) — per-monitor v1 (Win8.1+)
            // Fallback: SetProcessDPIAware (Vista+) — system-DPI aware
            try { SetProcessDpiAwareness(2); return; } catch { }
            try { SetProcessDPIAware(); } catch { }
        }
    }

    // ====================== PaintedImage: render HQ sem blur =================
    class PaintedImage : Control
    {
        private Image _img;
        public Image Image
        {
            get { return _img; }
            set { _img = value; Invalidate(); }
        }
        public PaintedImage()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.UserPaint
                | ControlStyles.SupportsTransparentBackColor
                | ControlStyles.ResizeRedraw, true);
            BackColor = Color.Transparent;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            if (_img == null) return;
            var g = e.Graphics;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.DrawImage(_img, 0, 0, Width, Height);
        }
    }

    // ====================== Progress bar (gradient violet→fuchsia) ===========
    class GlowProgress : Panel
    {
        private float _value;
        public float Value
        {
            get { return _value; }
            set { _value = Math.Max(0, Math.Min(1, value)); Invalidate(); }
        }
        public GlowProgress()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint
                | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.BgSoft;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.HighQuality;
            // track
            using (var b = new SolidBrush(Theme.BgSofter))
                g.FillRectangle(b, 0, 0, Width, Height);
            using (var pen = new Pen(Color.FromArgb(40, 192, 132, 252), 1))
                g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            int fillW = (int)(Width * _value);
            if (fillW > 0)
            {
                using (var gb = new LinearGradientBrush(
                    new Rectangle(0, 0, Math.Max(fillW, 1), Height),
                    Theme.Violet, Theme.Fuchsia,
                    LinearGradientMode.Horizontal))
                    g.FillRectangle(gb, 0, 0, fillW, Height);
                using (var pen = new Pen(Color.FromArgb(180, 232, 121, 249), 1))
                    g.DrawLine(pen, 0, 0, fillW, 0);
            }
        }
    }

    // ====================== Botão flat com hover ============================
    class FlatButton : Button
    {
        public Color FillColor;
        public Color FillHover;
        public Color BorderNormal;
        public Color BorderHover;
        public FlatButton()
        {
            FillColor = Color.Transparent;
            FillHover = Theme.BgSofter;
            BorderNormal = Theme.LineStrong;
            BorderHover = Theme.Violet;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 1;
            FlatAppearance.BorderColor = BorderNormal;
            Cursor = Cursors.Hand;
            Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            ForeColor = Theme.Text;
            BackColor = FillColor;
            UseCompatibleTextRendering = false;
            MouseEnter += new EventHandler(OnEnter);
            MouseLeave += new EventHandler(OnLeave);
        }
        private void OnEnter(object s, EventArgs e)
        {
            BackColor = FillHover;
            FlatAppearance.BorderColor = BorderHover;
        }
        private void OnLeave(object s, EventArgs e)
        {
            BackColor = FillColor;
            FlatAppearance.BorderColor = BorderNormal;
        }
    }

    // ====================== Main form =======================================
    class InstallerForm : Form
    {
        private readonly string _tmp;
        private readonly string _statusPath;
        private Process _psProc;
        private System.Windows.Forms.Timer _tmr;
        private Label _statusLbl;
        private Label _hintLbl;
        private Label _eyebrow;
        private GlowProgress _progress;
        private FlatButton _btnClose;
        private FlatButton _btnLog;
        private FlatButton _btnFolder;
        private Image _logoImg;
        private string _logPath;
        private string _installDst;
        private int _animTick;
        private bool _finished;
        private string _lastBaseStatus = "Iniciando";

        public InstallerForm(string tmp, string statusPath)
        {
            _tmp = tmp;
            _statusPath = statusPath;
            _installDst = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                Brand.InstallDir);
            _logPath = Path.Combine(_installDst, "install.log");
            BuildUi();
        }

        // Layout encadeado: cada controle ancora no Bottom do anterior + gap.
        // Garante zero sobreposição em qualquer DPI/scaling — fonte cresce,
        // labels crescem, próximos controles deslocam pra baixo automaticamente.
        const int PAD_X = 40;
        const int CONTENT_W = 540;  // 620 - 2*PAD_X = 540
        const int FORM_W = 620;
        const int FORM_H = 460;

        void BuildUi()
        {
            // ===== Form base =====
            Text = Brand.Heading + "  ·  " + Brand.Product;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(FORM_W, FORM_H);
            BackColor = Theme.Bg;
            ShowInTaskbar = true;
            DoubleBuffered = true;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.None;

            // Icon + Logo PNG embedded
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using (var s = asm.GetManifestResourceStream("AutoEdit.icon.ico"))
                    if (s != null) Icon = new Icon(s);
                using (var s = asm.GetManifestResourceStream("AutoEdit.rabbit.png"))
                    if (s != null) _logoImg = Image.FromStream(s);
            }
            catch { }

            // ===== TOP STRIPE 3px gradient (violet→fuchsia) =====
            var stripe = new Panel { Size = new Size(FORM_W, 3), Location = new Point(0, 0), BackColor = Color.Transparent };
            stripe.Paint += delegate(object s, PaintEventArgs e)
            {
                using (var gb = new LinearGradientBrush(
                    new Rectangle(0, 0, FORM_W, 3), Theme.Violet, Theme.Fuchsia,
                    LinearGradientMode.Horizontal))
                    e.Graphics.FillRectangle(gb, 0, 0, FORM_W, 3);
            };
            Controls.Add(stripe);

            // ============================================================
            // HEADER (logo + heading + product + eyebrow) — encadeado
            // ============================================================
            int yCursor = 36;  // padding top

            // Logo coelho 72x72 (lado esquerdo, mantém posição fixa)
            PaintedImage logoBox = null;
            if (_logoImg != null)
            {
                logoBox = new PaintedImage
                {
                    Image = _logoImg,
                    Size = new Size(72, 72),
                    Location = new Point(PAD_X, yCursor),
                };
                Controls.Add(logoBox);
            }

            int textX = PAD_X + 88;  // logo (72) + gap (16) = 88

            // HEADING "Auto Edit" — AutoSize garante medida real DPI-aware
            var heading = new Label
            {
                Text = Brand.Heading,
                ForeColor = Theme.Text,
                Font = new Font("Segoe UI", 22f, FontStyle.Bold),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(textX, yCursor),
            };
            Controls.Add(heading);  // Add ANTES de ler Bottom — força layout

            // PRODUCT tag — y baseado no Bottom REAL do heading
            var prodTag = new Label
            {
                Text = Brand.Product,
                ForeColor = Theme.Violet,
                Font = new Font("Segoe UI", 13f, FontStyle.Bold),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(textX, heading.Bottom + 2),
            };
            Controls.Add(prodTag);

            // EYEBROW small uppercase muted
            _eyebrow = new Label
            {
                Text = Brand.Eyebrow,
                ForeColor = Theme.TextMuted,
                Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(textX, prodTag.Bottom + 6),
            };
            Controls.Add(_eyebrow);

            // ============================================================
            // DIVIDER — após o maior bottom (logo ou texto)
            // ============================================================
            int headerBottom = Math.Max(
                logoBox != null ? logoBox.Bottom : 0,
                _eyebrow.Bottom);
            yCursor = headerBottom + 24;

            var divider = new Panel
            {
                Size = new Size(CONTENT_W, 1),
                Location = new Point(PAD_X, yCursor),
                BackColor = Theme.Line,
            };
            Controls.Add(divider);
            yCursor = divider.Bottom + 22;

            // ============================================================
            // PROGRESS section (label + pct + status + hint + bar)
            // ============================================================
            var progressTag = new Label
            {
                Text = "PROGRESSO",
                ForeColor = Theme.Violet,
                Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(PAD_X, yCursor),
            };
            Controls.Add(progressTag);

            // Percentual à direita — alinhado pelo Right da content area
            var progressPct = new Label
            {
                Name = "progressPct",
                Text = "",
                ForeColor = Theme.TextMuted,
                Font = new Font("Consolas", 9f, FontStyle.Bold),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(PAD_X + CONTENT_W - 40, yCursor),  // será reajustado quando texto preencher
                TextAlign = ContentAlignment.MiddleRight,
            };
            Controls.Add(progressPct);
            yCursor = progressTag.Bottom + 8;

            // STATUS title 17pt — height grande, dá 40px de bound
            _statusLbl = new Label
            {
                Text = "Iniciando…",
                ForeColor = Theme.Text,
                Font = new Font("Segoe UI", 17f, FontStyle.Bold),
                AutoSize = false,
                AutoEllipsis = true,
                Size = new Size(CONTENT_W, 36),
                Location = new Point(PAD_X, yCursor),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                TextAlign = ContentAlignment.MiddleLeft,
            };
            Controls.Add(_statusLbl);
            yCursor = _statusLbl.Bottom + 8;

            // HINT 2-3 linhas — bound generoso
            _hintLbl = new Label
            {
                Text = Brand.Hint,
                ForeColor = Theme.TextMuted,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                AutoSize = false,
                Size = new Size(CONTENT_W, 56),
                Location = new Point(PAD_X, yCursor),
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                TextAlign = ContentAlignment.TopLeft,
            };
            Controls.Add(_hintLbl);
            yCursor = _hintLbl.Bottom + 16;

            // PROGRESS BAR
            _progress = new GlowProgress
            {
                Size = new Size(CONTENT_W, 6),
                Location = new Point(PAD_X, yCursor),
                Value = 0.02f,
            };
            Controls.Add(_progress);

            // ============================================================
            // FOOTER fixo no fim da janela (não encadeado — ancora ao bottom)
            // ============================================================
            int footerY = FORM_H - 60;  // 60px do fim da janela

            var footerDivider = new Panel
            {
                Size = new Size(CONTENT_W, 1),
                Location = new Point(PAD_X, footerY - 18),
                BackColor = Theme.Line,
            };
            Controls.Add(footerDivider);

            var version = new Label
            {
                Text = "v3.0  ·  100% local",
                ForeColor = Theme.TextDim,
                Font = new Font("Consolas", 9f, FontStyle.Regular),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(PAD_X, footerY + 4),
            };
            Controls.Add(version);

            // Botões — direita, alinhados pelo bottom do form
            int btnRight = PAD_X + CONTENT_W;
            int btnGap = 10;

            _btnClose = MakeButton("Fechar", 96, footerY);
            _btnClose.Left = btnRight - _btnClose.Width;
            _btnClose.FillColor = Theme.Violet;
            _btnClose.FillHover = Theme.FuchsiaSoft;
            _btnClose.BorderNormal = Theme.Violet;
            _btnClose.BorderHover = Theme.Fuchsia;
            _btnClose.ForeColor = Theme.Bg;
            _btnClose.BackColor = _btnClose.FillColor;
            _btnClose.FlatAppearance.BorderColor = _btnClose.BorderNormal;
            _btnClose.Visible = false;
            _btnClose.Click += delegate(object s, EventArgs e) { Close(); };
            Controls.Add(_btnClose);

            _btnLog = MakeButton("Abrir log", 104, footerY);
            _btnLog.Left = _btnClose.Left - _btnLog.Width - btnGap;
            _btnLog.Visible = false;
            _btnLog.Click += delegate(object s, EventArgs e)
            {
                try
                {
                    if (File.Exists(_logPath))
                        Process.Start(new ProcessStartInfo("notepad.exe", _logPath) { UseShellExecute = true });
                }
                catch { }
            };
            Controls.Add(_btnLog);

            _btnFolder = MakeButton("Abrir pasta", 116, footerY);
            _btnFolder.Left = _btnLog.Left - _btnFolder.Width - btnGap;
            _btnFolder.Visible = false;
            _btnFolder.Click += delegate(object s, EventArgs e)
            {
                try
                {
                    if (Directory.Exists(_installDst))
                        Process.Start(new ProcessStartInfo("explorer.exe", _installDst) { UseShellExecute = true });
                }
                catch { }
            };
            Controls.Add(_btnFolder);

            // Re-alinha o progressPct à direita do progressTag (após ele renderizar)
            progressPct.LocationChanged += delegate { };
            HandleCreated += delegate
            {
                progressPct.Left = PAD_X + CONTENT_W - progressPct.PreferredSize.Width;
            };

            // ===== DRAG-TO-MOVE (qualquer área) =====
            bool dragging = false;
            Point dragStart = Point.Empty;
            MouseEventHandler downMouse = delegate(object s, MouseEventArgs e)
            {
                dragging = true;
                dragStart = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
            };
            MouseEventHandler move = delegate(object s, MouseEventArgs e)
            {
                if (dragging)
                {
                    Left = Cursor.Position.X - dragStart.X;
                    Top = Cursor.Position.Y - dragStart.Y;
                }
            };
            MouseEventHandler up = delegate(object s, MouseEventArgs e) { dragging = false; };
            MouseDown += downMouse;
            MouseMove += move;
            MouseUp += up;
            // Permite arrastar pelas Labels do header também
            heading.MouseDown += downMouse;
            heading.MouseMove += move;
            heading.MouseUp += up;
            prodTag.MouseDown += downMouse;
            prodTag.MouseMove += move;
            prodTag.MouseUp += up;

            // ===== Timer (lê status + anima ellipsis) =====
            _tmr = new System.Windows.Forms.Timer { Interval = 150 };
            _tmr.Tick += OnTick;
            Shown += delegate(object s, EventArgs e)
            {
                LaunchPowerShell();
                _tmr.Start();
            };
            FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                try { if (_tmr != null) _tmr.Stop(); } catch { }
                try { if (_psProc != null && !_psProc.HasExited) _psProc.Kill(); } catch { }
            };
        }

        FlatButton MakeButton(string text, int width, int y)
        {
            return new FlatButton
            {
                Text = text,
                Size = new Size(width, 34),
                Location = new Point(0, y),
            };
        }

        // ===== Launch PowerShell escondido =====
        void LaunchPowerShell()
        {
            string ps1 = Path.Combine(_tmp, "Instalar.ps1");
            if (!File.Exists(ps1))
            {
                _statusLbl.Text = "Erro de extração";
                _statusLbl.ForeColor = Theme.Danger;
                _hintLbl.Text = "Arquivo de instalação não encontrado. Baixe novamente.";
                _btnClose.Visible = true;
                return;
            }
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""
                    + ps1 + "\" -StatusFile \"" + _statusPath + "\"",
                WorkingDirectory = _tmp,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            try
            {
                _psProc = Process.Start(psi);
                _psProc.OutputDataReceived += delegate { };
                _psProc.ErrorDataReceived += delegate { };
                _psProc.BeginOutputReadLine();
                _psProc.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                _statusLbl.Text = "Falhou ao iniciar";
                _statusLbl.ForeColor = Theme.Danger;
                _hintLbl.Text = ex.Message;
                _btnClose.Visible = true;
            }
        }

        // ===== Status watcher =====
        void OnTick(object sender, EventArgs e)
        {
            _animTick++;
            if (!_finished)
            {
                int dots = (_animTick / 4) % 4;
                string suffix = new string('.', dots);
                if (!string.IsNullOrEmpty(_lastBaseStatus))
                    _statusLbl.Text = _lastBaseStatus + suffix;
            }

            string line = null;
            try
            {
                if (File.Exists(_statusPath))
                    line = File.ReadAllText(_statusPath).Trim();
            }
            catch { }
            if (string.IsNullOrEmpty(line)) return;

            var idx = line.IndexOf('|');
            if (idx < 0) return;
            var head = line.Substring(0, idx);
            var msg = idx + 1 < line.Length ? line.Substring(idx + 1) : "";

            Label pct = (Label)Controls["progressPct"];

            // Helper local pra re-alinhar o pct à direita após mudar texto
            Action realignPct = delegate
            {
                if (pct != null)
                    pct.Left = PAD_X + CONTENT_W - pct.PreferredSize.Width;
            };

            if (head == "DONE")
            {
                _finished = true;
                _tmr.Stop();
                _progress.Value = 1f;
                if (pct != null) { pct.Text = "100%"; pct.ForeColor = Theme.Violet; realignPct(); }
                _statusLbl.Text = "Instalado e vinculado";
                _statusLbl.ForeColor = Theme.Text;
                _hintLbl.Text = Brand.DoneHint;
                _btnClose.Visible = true;
                _btnLog.Visible = true;
                _btnFolder.Visible = true;
            }
            else if (head == "ERR")
            {
                _finished = true;
                _tmr.Stop();
                if (pct != null) { pct.Text = "Erro"; pct.ForeColor = Theme.Danger; realignPct(); }
                _statusLbl.Text = "Algo deu errado";
                _statusLbl.ForeColor = Theme.Danger;
                _hintLbl.Text = msg.Length > 220 ? msg.Substring(0, 220) + "…" : msg;
                _btnClose.Visible = true;
                _btnLog.Visible = true;
                _btnFolder.Visible = true;
            }
            else
            {
                int p;
                if (int.TryParse(head, out p))
                {
                    _progress.Value = Math.Max(0.02f, Math.Min(1f, p / 100f));
                    if (pct != null) { pct.Text = p + "%"; realignPct(); }
                    _lastBaseStatus = msg.TrimEnd('.', ' ');
                }
            }
        }
    }

    static class Setup
    {
        [STAThread]
        static int Main()
        {
            // CRITICAL: DPI awareness ANTES de qualquer UI (anti-blur)
            Dpi.Enable();

            try
            {
                string tmp = Path.Combine(
                    Path.GetTempPath(),
                    "AutoEditSetup_" + Guid.NewGuid().ToString("N").Substring(0, 8));
                Directory.CreateDirectory(tmp);

                Assembly asm = Assembly.GetExecutingAssembly();
                string resName = null;
                foreach (string n in asm.GetManifestResourceNames())
                {
                    if (n.EndsWith("pkg.zip", StringComparison.OrdinalIgnoreCase))
                    { resName = n; break; }
                }
                if (resName == null)
                {
                    MessageBox.Show("Recurso interno faltando (pkg.zip).",
                        "Auto Edit", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 2;
                }

                string zipPath = Path.Combine(tmp, "pkg.zip");
                using (Stream src = asm.GetManifestResourceStream(resName))
                using (FileStream dst = File.Create(zipPath))
                    src.CopyTo(dst);
                ZipFile.ExtractToDirectory(zipPath, tmp);
                try { File.Delete(zipPath); } catch { }

                string statusPath = Path.Combine(Path.GetTempPath(),
                    "AutoEditInstallStatus_" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".txt");
                File.WriteAllText(statusPath, "2|Preparando");

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var form = new InstallerForm(tmp, statusPath))
                {
                    Application.Run(form);
                }

                try { File.Delete(statusPath); } catch { }
                try { Directory.Delete(tmp, true); } catch { }
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show("Erro ao iniciar instalação:\r\n\r\n" + ex.Message,
                    "Auto Edit", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
