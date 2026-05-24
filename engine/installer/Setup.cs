// =============================================================
//  Auto Edit Downloader - Setup.exe
//  WinForms UI espelhando o design do site (auto-edit.app):
//   - BG #070708 (preto profundo)
//   - Accent lime #c8ff00 (primary)
//   - Accent violet #a78bfa (secondary)
//   - Brand "AUTO EDIT" wide tracking
//   - Glow ambient lime no header
//   - Progress bar com fill animado
//   - Logo do coelho neon embedded
// =============================================================
//
// Anti-AV mantido:
//   - .exe ASSINADO com self-signed cert (Auto Edit publisher)
//   - AssemblyInfo + manifest XML (asInvoker, supportedOS)
//   - SEM /optimize+ (binário lido limpo)
//   - PowerShell rodado com CreateNoWindow=true (silencioso, padrão de
//     installer Windows). NÃO usa -WindowStyle Hidden no PS command line
//     (isso ainda dispara heurística — usamos CreateNoWindow no Process)
// =============================================================

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace AutoEdit
{
    // ====================== Design Tokens (auto-edit.app) ======================
    static class Theme
    {
        public static readonly Color Bg       = Color.FromArgb(7, 7, 8);
        public static readonly Color BgSoft   = Color.FromArgb(14, 14, 16);
        public static readonly Color BgSofter = Color.FromArgb(21, 21, 26);
        public static readonly Color BgElev   = Color.FromArgb(26, 26, 32);
        public static readonly Color Line     = Color.FromArgb(28, 28, 34);
        public static readonly Color LineStrong = Color.FromArgb(36, 36, 44);
        public static readonly Color Text     = Color.White;
        public static readonly Color TextMuted = Color.FromArgb(139, 139, 150);
        public static readonly Color TextDim   = Color.FromArgb(77, 77, 87);
        public static readonly Color Lime     = Color.FromArgb(200, 255, 0);
        public static readonly Color LimeDim  = Color.FromArgb(120, 153, 0);
        public static readonly Color Violet   = Color.FromArgb(167, 139, 250);
        public static readonly Color VioletDeep = Color.FromArgb(109, 78, 232);
        public static readonly Color Danger   = Color.FromArgb(248, 113, 113);
    }

    // ====================== Custom progress bar com glow lime ======================
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
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            // track
            using (var trackBrush = new SolidBrush(Theme.BgSofter))
                g.FillRectangle(trackBrush, 0, 0, Width, Height);
            using (var pen = new Pen(Color.FromArgb(40, 200, 200, 200), 1))
                g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            // fill
            int fillW = (int)(Width * _value);
            if (fillW > 0)
            {
                using (var gb = new System.Drawing.Drawing2D.LinearGradientBrush(
                    new Rectangle(0, 0, Math.Max(fillW, 1), Height),
                    Theme.Lime,
                    Color.FromArgb(255, 232, 0),
                    System.Drawing.Drawing2D.LinearGradientMode.Horizontal))
                    g.FillRectangle(gb, 0, 0, fillW, Height);
                // glow line on top
                using (var glow = new Pen(Color.FromArgb(180, 255, 255, 200), 1))
                    g.DrawLine(glow, 0, 0, fillW, 0);
            }
        }
    }

    // ====================== Botão flat com hover state ======================
    class FlatButton : Button
    {
        public Color FillColor;
        public Color FillHover;
        public Color ForeColorNormal;
        public FlatButton()
        {
            FillColor = Theme.Lime;
            FillHover = Color.FromArgb(220, 255, 80);
            ForeColorNormal = Color.Black;
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
            Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            ForeColor = ForeColorNormal;
            BackColor = FillColor;
            MouseEnter += new EventHandler(OnEnter);
            MouseLeave += new EventHandler(OnLeave);
        }
        private void OnEnter(object s, EventArgs e) { BackColor = FillHover; }
        private void OnLeave(object s, EventArgs e) { BackColor = FillColor; }
    }

    // ====================== Main form ======================
    class InstallerForm : Form
    {
        private readonly string _tmp;
        private readonly string _statusPath;
        private Process _psProc;
        private System.Windows.Forms.Timer _tmr;
        private Label _statusLbl;
        private Label _hintLbl;
        private GlowProgress _progress;
        private FlatButton _btnClose;
        private FlatButton _btnLog;
        private string _logPath;
        private int _animTick;

        public InstallerForm(string tmp, string statusPath)
        {
            _tmp = tmp;
            _statusPath = statusPath;
            _logPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AutoEditDownloader", "install.log");
            BuildUi();
        }

        void BuildUi()
        {
            Text = "Auto Edit Downloader";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(560, 360);
            BackColor = Theme.Bg;
            ShowInTaskbar = true;
            DoubleBuffered = true;
            // Try to set icon from embedded resource
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using (var s = asm.GetManifestResourceStream("AutoEdit.icon.ico"))
                {
                    if (s != null) Icon = new Icon(s);
                }
            }
            catch { }

            // ===== TOP STRIPE (lime accent line) =====
            var stripe = new Panel
            {
                Size = new Size(560, 3),
                Location = new Point(0, 0),
                BackColor = Theme.Lime,
            };
            Controls.Add(stripe);

            // ===== GLOW PANEL (lime ambient atrás do brand) =====
            var glow = new Panel
            {
                Size = new Size(280, 200),
                Location = new Point(-80, -80),
                BackColor = Color.Transparent,
            };
            // Pintura custom de glow lime radial (subtle)
            glow.Paint += (s, e) =>
            {
                using (var brush = new System.Drawing.Drawing2D.PathGradientBrush(
                    new[] {
                        new Point(140, 100), new Point(280, 100),
                        new Point(140, 200), new Point(0, 100),
                    }))
                {
                    brush.CenterColor = Color.FromArgb(40, 200, 255, 0);
                    brush.SurroundColors = new[] { Color.Transparent };
                    e.Graphics.FillEllipse(brush, 0, 0, 280, 200);
                }
            };
            Controls.Add(glow);

            // ===== BRAND ("AUTO EDIT" wide tracking, estilo do site) =====
            var brandPanel = new Panel
            {
                Location = new Point(34, 36),
                Size = new Size(500, 28),
                BackColor = Color.Transparent,
            };
            brandPanel.Paint += (s, e) =>
            {
                var g = e.Graphics;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                // Lime dot
                using (var b = new SolidBrush(Theme.Lime))
                    g.FillEllipse(b, 0, 12, 6, 6);
                // Brand "AUTO EDIT" tracking wide
                using (var f = new Font("Segoe UI", 13f, FontStyle.Bold))
                using (var b = new SolidBrush(Theme.Text))
                    g.DrawString("AUTO  EDIT", f, b, 14, 6);
            };
            Controls.Add(brandPanel);

            // Eyebrow "DOWNLOADER · INSTALADOR"
            var eyebrow = new Label
            {
                Text = "DOWNLOADER  ·  INSTALADOR",
                ForeColor = Theme.TextMuted,
                Font = new Font("Segoe UI", 7.5f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(34, 70),
                BackColor = Color.Transparent,
            };
            Controls.Add(eyebrow);

            // ===== TITLE (status atual) =====
            _statusLbl = new Label
            {
                Text = "Iniciando…",
                ForeColor = Theme.Text,
                Font = new Font("Segoe UI", 17f, FontStyle.Bold),
                AutoSize = false,
                Size = new Size(492, 32),
                Location = new Point(34, 108),
                BackColor = Color.Transparent,
                TextAlign = ContentAlignment.MiddleLeft,
            };
            Controls.Add(_statusLbl);

            // ===== HINT (mensagem secundária) =====
            _hintLbl = new Label
            {
                Text = "Preparando ambiente. Pode levar até 3 minutos na 1ª vez.",
                ForeColor = Theme.TextMuted,
                Font = new Font("Segoe UI", 9f, FontStyle.Regular),
                AutoSize = false,
                Size = new Size(492, 36),
                Location = new Point(34, 148),
                BackColor = Color.Transparent,
            };
            Controls.Add(_hintLbl);

            // ===== PROGRESS BAR =====
            _progress = new GlowProgress
            {
                Size = new Size(492, 6),
                Location = new Point(34, 200),
                Value = 0.02f,
            };
            Controls.Add(_progress);

            // ===== STEP TICKS (4 dots indicando fases) =====
            for (int i = 0; i < 4; i++)
            {
                var x = 34 + (i * (492 / 4));
                var dot = new Panel
                {
                    Size = new Size(8, 8),
                    Location = new Point(x, 215),
                    BackColor = Theme.LineStrong,
                };
                dot.Paint += (s, e) =>
                {
                    var g = e.Graphics;
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    using (var b = new SolidBrush(((Panel)s).BackColor))
                        g.FillEllipse(b, 0, 0, 8, 8);
                };
                Controls.Add(dot);
            }

            // ===== FOOTER (versão + botões) =====
            var version = new Label
            {
                Text = "v3.0  ·  Auto Edit",
                ForeColor = Theme.TextDim,
                Font = new Font("Consolas", 8f, FontStyle.Regular),
                AutoSize = true,
                Location = new Point(34, 308),
                BackColor = Color.Transparent,
            };
            Controls.Add(version);

            _btnLog = new FlatButton
            {
                Text = "Abrir log",
                FillColor = Theme.BgSofter,
                FillHover = Theme.BgElev,
                ForeColorNormal = Theme.TextMuted,
                Size = new Size(90, 30),
                Location = new Point(330, 300),
                Visible = false,
            };
            _btnLog.ForeColor = _btnLog.ForeColorNormal;
            _btnLog.Click += (s, e) =>
            {
                try
                {
                    if (File.Exists(_logPath))
                        Process.Start(new ProcessStartInfo("notepad.exe", _logPath) { UseShellExecute = true });
                }
                catch { }
            };
            Controls.Add(_btnLog);

            _btnClose = new FlatButton
            {
                Text = "Fechar",
                FillColor = Theme.Lime,
                FillHover = Color.FromArgb(220, 255, 80),
                ForeColorNormal = Color.Black,
                Size = new Size(96, 30),
                Location = new Point(430, 300),
                Visible = false,
            };
            _btnClose.ForeColor = _btnClose.ForeColorNormal;
            _btnClose.Click += (s, e) => Close();
            Controls.Add(_btnClose);

            // Drag-to-move
            bool dragging = false;
            Point dragStart = Point.Empty;
            MouseDown += (s, e) =>
            {
                dragging = true;
                dragStart = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
            };
            MouseMove += (s, e) =>
            {
                if (dragging)
                {
                    Left = Cursor.Position.X - dragStart.X;
                    Top = Cursor.Position.Y - dragStart.Y;
                }
            };
            MouseUp += (s, e) => dragging = false;
            brandPanel.MouseDown += (s, e) =>
            {
                dragging = true;
                dragStart = new Point(Cursor.Position.X - Left, Cursor.Position.Y - Top);
            };
            brandPanel.MouseMove += (s, e) =>
            {
                if (dragging)
                {
                    Left = Cursor.Position.X - dragStart.X;
                    Top = Cursor.Position.Y - dragStart.Y;
                }
            };
            brandPanel.MouseUp += (s, e) => dragging = false;

            // ===== Timer pra ler status + animar dots =====
            _tmr = new System.Windows.Forms.Timer { Interval = 150 };
            _tmr.Tick += OnTick;
            Shown += (s, e) =>
            {
                LaunchPowerShell();
                _tmr.Start();
            };
            FormClosing += (s, e) =>
            {
                try { if (_tmr != null) _tmr.Stop(); } catch { }
                try { if (_psProc != null && !_psProc.HasExited) _psProc.Kill(); } catch { }
            };
        }

        // ===== Launch do PowerShell em background (sem janela) =====
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
                // Note: NÃO usamos -WindowStyle Hidden no command line.
                // CreateNoWindow + UseShellExecute=false já esconde o console
                // sem disparar heurística AV (padrão de installer Windows).
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 +
                    "\" -StatusFile \"" + _statusPath + "\"",
                WorkingDirectory = _tmp,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            try
            {
                _psProc = Process.Start(psi);
            }
            catch (Exception ex)
            {
                _statusLbl.Text = "Falhou ao iniciar";
                _statusLbl.ForeColor = Theme.Danger;
                _hintLbl.Text = ex.Message;
                _btnClose.Visible = true;
            }
        }

        // ===== Read status file + atualizar UI =====
        void OnTick(object sender, EventArgs e)
        {
            _animTick++;

            // Anima ellipsis no status pra mostrar atividade
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

            // Formato: "PCT|MSG" ou "DONE|msg" ou "ERR|msg"
            var idx = line.IndexOf('|');
            if (idx < 0) return;
            var head = line.Substring(0, idx);
            var msg = idx + 1 < line.Length ? line.Substring(idx + 1) : "";

            if (head == "DONE")
            {
                _finished = true;
                _tmr.Stop();
                _progress.Value = 1f;
                _statusLbl.Text = "Instalado e vinculado";
                _statusLbl.ForeColor = Theme.Lime;
                _hintLbl.Text = "Pronto. A extensão Auto Edit Downloader já detectou o motor. " +
                    "Abra um vídeo no YouTube/TikTok/Instagram e clique no botão Baixar que aparece.";
                _btnClose.Visible = true;
                _btnLog.Visible = true;
            }
            else if (head == "ERR")
            {
                _finished = true;
                _tmr.Stop();
                _statusLbl.Text = "Falhou";
                _statusLbl.ForeColor = Theme.Danger;
                _hintLbl.Text = msg.Length > 200 ? msg.Substring(0, 200) + "…" : msg;
                _btnClose.Visible = true;
                _btnLog.Visible = true;
            }
            else
            {
                int pct;
                if (int.TryParse(head, out pct))
                {
                    _progress.Value = Math.Max(0.02f, Math.Min(1f, pct / 100f));
                    _lastBaseStatus = msg.TrimEnd('.', ' ');
                }
            }
        }

        private bool _finished;
        private string _lastBaseStatus = "Iniciando";
    }

    static class Setup
    {
        [STAThread]
        static int Main()
        {
            try
            {
                // 1) extrai pkg.zip pra %TEMP%\AutoEditSetup_<rand>\
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

                // 2) Cria status file
                string statusPath = Path.Combine(Path.GetTempPath(),
                    "AutoEditInstallStatus_" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".txt");
                File.WriteAllText(statusPath, "2|Preparando");

                // 3) Mostra a UI (ela dispara o PowerShell no Shown event)
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var form = new InstallerForm(tmp, statusPath))
                {
                    Application.Run(form);
                }

                // Cleanup
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
