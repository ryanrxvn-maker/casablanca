// =============================================================
//  Auto Edit Downloader - Setup.exe
//  WinForms UI espelhando as cores reais do site (auto-edit.app):
//   - BG #070708 (preto profundo)
//   - Accent VIOLET #c084fc (primary, igual ao logo)
//   - Accent FUCHSIA #d946ef (segundo glow do logo coelho)
//   - Logo do coelho neon embedded (PNG)
//   - Glow violet+fuchsia ambient
//   - Zero CMD visível (RedirectStandardOutput suprime console)
// =============================================================

using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

namespace AutoEdit
{
    // ====================== Branding (parametrizado via #define) ===========
    // Mesmo Setup.cs serve 2 instaladores:
    //   - Downloader (default)            → AutoEditDownloader / pasta LOCALAPPDATA
    //   - Smart Remover (csc /define:REMOVER) → AutoEditSmartRemover
    static class Brand
    {
#if REMOVER
        public const string Product    = "Smart Remover";
        public const string Eyebrow    = "VÍDEO COM IA  ·  INSTALADOR";
        public const string InstallDir = "AutoEditSmartRemover";
        public const string Hint       = "Baixando IA + componentes (~600 MB) na 1ª vez. Pode levar 3–10 min.";
#else
        public const string Product    = "Auto Edit";
        public const string Eyebrow    = "DOWNLOADER  ·  INSTALADOR";
        public const string InstallDir = "AutoEditDownloader";
        public const string Hint       = "Baixando componentes na 1ª vez (~250 MB). Pode levar 1–3 min.";
#endif
        public const string DoneHint   = "Pronto. O motor já foi vinculado. Use a ferramenta no site normalmente.";
    }

    // ====================== Design Tokens (auto-edit.app) ======================
    static class Theme
    {
        public static readonly Color Bg          = Color.FromArgb(7, 7, 8);
        public static readonly Color BgSoft      = Color.FromArgb(14, 14, 16);
        public static readonly Color BgSofter    = Color.FromArgb(21, 21, 26);
        public static readonly Color BgElev      = Color.FromArgb(26, 26, 32);
        public static readonly Color Line        = Color.FromArgb(28, 28, 34);
        public static readonly Color LineStrong  = Color.FromArgb(36, 36, 44);
        public static readonly Color Text        = Color.White;
        public static readonly Color TextMuted   = Color.FromArgb(139, 139, 150);
        public static readonly Color TextDim     = Color.FromArgb(77, 77, 87);
        // PRIMARY (igual ao logo do coelho): violet bright
        public static readonly Color Violet      = Color.FromArgb(192, 132, 252); // #c084fc
        public static readonly Color VioletSoft  = Color.FromArgb(167, 139, 250); // #a78bfa
        public static readonly Color VioletDeep  = Color.FromArgb(109, 78, 232);  // #6d4ee8
        // SECONDARY (segundo glow do logo): fuchsia/rosa
        public static readonly Color Fuchsia     = Color.FromArgb(217, 70, 239);  // #d946ef
        public static readonly Color FuchsiaSoft = Color.FromArgb(232, 121, 249); // #e879f9
        // Lime mantido só pra success state pequeno
        public static readonly Color Lime        = Color.FromArgb(200, 255, 0);
        public static readonly Color Danger      = Color.FromArgb(248, 113, 113);
    }

    // ====================== Progress bar com gradient violet→fuchsia ==========
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
            g.SmoothingMode = SmoothingMode.AntiAlias;
            // track
            using (var b = new SolidBrush(Theme.BgSofter))
                g.FillRectangle(b, 0, 0, Width, Height);
            using (var pen = new Pen(Color.FromArgb(30, 192, 132, 252), 1))
                g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            // fill — gradient violet → fuchsia (igual aos dois glows do logo)
            int fillW = (int)(Width * _value);
            if (fillW > 0)
            {
                using (var gb = new LinearGradientBrush(
                    new Rectangle(0, 0, Math.Max(fillW, 1), Height),
                    Theme.Violet,
                    Theme.Fuchsia,
                    LinearGradientMode.Horizontal))
                    g.FillRectangle(gb, 0, 0, fillW, Height);
                // highlight line topo
                using (var pen = new Pen(Color.FromArgb(160, 232, 121, 249), 1))
                    g.DrawLine(pen, 0, 0, fillW, 0);
            }
        }
    }

    // ====================== Botão flat com hover ==============================
    class FlatButton : Button
    {
        public Color FillColor;
        public Color FillHover;
        public Color BorderNormal;
        public Color BorderHover;
        public int BorderSize = 1;
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

    // ====================== Main form ==========================================
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

        void BuildUi()
        {
            Text = "Auto Edit  ·  " + Brand.Product;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(580, 380);
            BackColor = Theme.Bg;
            ShowInTaskbar = true;
            DoubleBuffered = true;

            // Try load embedded PNG do coelho + ICO
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using (var s = asm.GetManifestResourceStream("AutoEdit.icon.ico"))
                {
                    if (s != null) Icon = new Icon(s);
                }
                using (var s = asm.GetManifestResourceStream("AutoEdit.rabbit.png"))
                {
                    if (s != null) _logoImg = Image.FromStream(s);
                }
            }
            catch { }

            // ===== TOP STRIPE com gradient violet→fuchsia (igual logo) =========
            var stripe = new Panel
            {
                Size = new Size(580, 3),
                Location = new Point(0, 0),
                BackColor = Color.Transparent,
            };
            stripe.Paint += delegate(object s, PaintEventArgs e)
            {
                using (var gb = new LinearGradientBrush(
                    new Rectangle(0, 0, 580, 3),
                    Theme.Violet, Theme.Fuchsia,
                    LinearGradientMode.Horizontal))
                    e.Graphics.FillRectangle(gb, 0, 0, 580, 3);
            };
            Controls.Add(stripe);

            // ===== GLOW ambient (radial violet+fuchsia atrás do coelho) =======
            var glow = new Panel
            {
                Size = new Size(360, 240),
                Location = new Point(-100, -60),
                BackColor = Color.Transparent,
            };
            glow.Paint += delegate(object s, PaintEventArgs e)
            {
                var g = e.Graphics;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var path = new System.Drawing.Drawing2D.GraphicsPath())
                {
                    path.AddEllipse(0, 0, 360, 240);
                    using (var pgb = new PathGradientBrush(path))
                    {
                        pgb.CenterColor = Color.FromArgb(70, 192, 132, 252); // violet glow
                        pgb.SurroundColors = new[] { Color.Transparent };
                        pgb.CenterPoint = new PointF(180, 120);
                        g.FillEllipse(pgb, 0, 0, 360, 240);
                    }
                }
                // Segundo glow fuchsia menor, deslocado
                using (var path = new System.Drawing.Drawing2D.GraphicsPath())
                {
                    path.AddEllipse(80, 40, 220, 160);
                    using (var pgb = new PathGradientBrush(path))
                    {
                        pgb.CenterColor = Color.FromArgb(45, 217, 70, 239); // fuchsia
                        pgb.SurroundColors = new[] { Color.Transparent };
                        g.FillEllipse(pgb, 80, 40, 220, 160);
                    }
                }
            };
            Controls.Add(glow);

            // ===== HEADER (logo coelho + brand text) ==========================
            // Logo coelho 56px no canto top-left
            if (_logoImg != null)
            {
                var logoBox = new PictureBox
                {
                    Image = _logoImg,
                    SizeMode = PictureBoxSizeMode.Zoom,
                    Size = new Size(56, 56),
                    Location = new Point(36, 32),
                    BackColor = Color.Transparent,
                };
                Controls.Add(logoBox);
            }

            // Brand text "Auto Edit"
            var brandPanel = new Panel
            {
                Location = new Point(108, 38),
                Size = new Size(420, 50),
                BackColor = Color.Transparent,
            };
            brandPanel.Paint += delegate(object s, PaintEventArgs e)
            {
                var g = e.Graphics;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                using (var f = new Font("Segoe UI", 20f, FontStyle.Bold))
                using (var b = new SolidBrush(Theme.Text))
                    g.DrawString(Brand.Product, f, b, 0, 0);
                using (var f = new Font("Segoe UI", 8f, FontStyle.Bold))
                using (var b = new SolidBrush(Theme.Violet))
                    g.DrawString(Brand.Eyebrow, f, b, 1, 34);
            };
            Controls.Add(brandPanel);

            // ===== DIVIDER linha sutil entre header e content =================
            var divider = new Panel
            {
                Size = new Size(508, 1),
                Location = new Point(36, 110),
                BackColor = Theme.Line,
            };
            Controls.Add(divider);

            // ===== EYEBROW pequena (progress %) ===============================
            _eyebrow = new Label
            {
                Text = "PROGRESSO",
                ForeColor = Theme.TextMuted,
                Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(36, 128),
                BackColor = Color.Transparent,
            };
            Controls.Add(_eyebrow);

            // ===== TITLE (status dinâmico) ===================================
            _statusLbl = new Label
            {
                Text = "Iniciando…",
                ForeColor = Theme.Text,
                Font = new Font("Segoe UI", 18f, FontStyle.Bold),
                AutoSize = false,
                Size = new Size(508, 34),
                Location = new Point(36, 148),
                BackColor = Color.Transparent,
                TextAlign = ContentAlignment.MiddleLeft,
            };
            Controls.Add(_statusLbl);

            // ===== HINT (mensagem secundária) =================================
            _hintLbl = new Label
            {
                Text = Brand.Hint,
                ForeColor = Theme.TextMuted,
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                AutoSize = false,
                Size = new Size(508, 38),
                Location = new Point(36, 188),
                BackColor = Color.Transparent,
            };
            Controls.Add(_hintLbl);

            // ===== PROGRESS BAR ===============================================
            _progress = new GlowProgress
            {
                Size = new Size(508, 6),
                Location = new Point(36, 238),
                Value = 0.02f,
            };
            Controls.Add(_progress);

            // ===== FOOTER divider + actions ===================================
            var footerDivider = new Panel
            {
                Size = new Size(508, 1),
                Location = new Point(36, 318),
                BackColor = Theme.Line,
            };
            Controls.Add(footerDivider);

            var version = new Label
            {
                Text = "v3.0  ·  Auto Edit  ·  100% local",
                ForeColor = Theme.TextDim,
                Font = new Font("Consolas", 8f, FontStyle.Regular),
                AutoSize = true,
                Location = new Point(36, 336),
                BackColor = Color.Transparent,
            };
            Controls.Add(version);

            _btnFolder = new FlatButton
            {
                Text = "Abrir pasta",
                Size = new Size(110, 32),
                Location = new Point(266, 330),
                Visible = false,
            };
            _btnFolder.Click += delegate(object s, EventArgs e)
            {
                try
                {
                    if (Directory.Exists(_installDst))
                        Process.Start(new ProcessStartInfo("explorer.exe", _installDst)
                            { UseShellExecute = true });
                }
                catch { }
            };
            Controls.Add(_btnFolder);

            _btnLog = new FlatButton
            {
                Text = "Abrir log",
                Size = new Size(90, 32),
                Location = new Point(382, 330),
                Visible = false,
            };
            _btnLog.Click += delegate(object s, EventArgs e)
            {
                try
                {
                    if (File.Exists(_logPath))
                        Process.Start(new ProcessStartInfo("notepad.exe", _logPath)
                            { UseShellExecute = true });
                }
                catch { }
            };
            Controls.Add(_btnLog);

            // Botão principal "Fechar" — primary style (violet fill)
            _btnClose = new FlatButton
            {
                Text = "Fechar",
                Size = new Size(76, 32),
                Location = new Point(478, 330),
                Visible = false,
            };
            _btnClose.FillColor = Theme.Violet;
            _btnClose.FillHover = Theme.FuchsiaSoft;
            _btnClose.BorderNormal = Theme.Violet;
            _btnClose.BorderHover = Theme.Fuchsia;
            _btnClose.ForeColor = Theme.Bg;
            _btnClose.BackColor = _btnClose.FillColor;
            _btnClose.FlatAppearance.BorderColor = _btnClose.BorderNormal;
            _btnClose.Click += delegate(object s, EventArgs e) { Close(); };
            Controls.Add(_btnClose);

            // ===== DRAG-TO-MOVE ===============================================
            bool dragging = false;
            Point dragStart = Point.Empty;
            EventHandler down = null;
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
            brandPanel.MouseDown += downMouse;
            brandPanel.MouseMove += move;
            brandPanel.MouseUp += up;

            // ===== TIMER (lê status + anima) ==================================
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

        // ===== Launch do PowerShell em background ===========================
        // Zero janela: CreateNoWindow + UseShellExecute=false +
        // RedirectStandardOutput=true → suprime alocação de console.
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
                UseShellExecute = false,        // necessário pra Redirect*
                CreateNoWindow = true,           // sem janela
                RedirectStandardOutput = true,   // suprime alocação de console
                RedirectStandardError = true,    // idem
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            try
            {
                _psProc = Process.Start(psi);
                // Drain async dos streams pra não bloquear o PS
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

        // ===== Status file watcher + animação ============================
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

            if (head == "DONE")
            {
                _finished = true;
                _tmr.Stop();
                _progress.Value = 1f;
                _eyebrow.Text = "CONCLUÍDO  ·  100%";
                _eyebrow.ForeColor = Theme.Violet;
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
                _eyebrow.Text = "FALHOU";
                _eyebrow.ForeColor = Theme.Danger;
                _statusLbl.Text = "Algo deu errado";
                _statusLbl.ForeColor = Theme.Danger;
                _hintLbl.Text = msg.Length > 200 ? msg.Substring(0, 200) + "…" : msg;
                _btnClose.Visible = true;
                _btnLog.Visible = true;
                _btnFolder.Visible = true;
            }
            else
            {
                int pct;
                if (int.TryParse(head, out pct))
                {
                    _progress.Value = Math.Max(0.02f, Math.Min(1f, pct / 100f));
                    _eyebrow.Text = "PROGRESSO  ·  " + pct + "%";
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
                    {
                        resName = n; break;
                    }
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
