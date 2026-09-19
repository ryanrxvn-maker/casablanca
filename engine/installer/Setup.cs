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
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
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

    // Completion is a protocol, not a process-exit event. PowerShell may
    // write DONE and exit entirely between two 150ms UI ticks.
    enum InstallerCompletionState
    {
        Installing, WaitingForExit, WaitingForStatus, WaitingForOutput,
        Verifying, Success, Failure
    }

    sealed class EngineHealthResult
    {
        public readonly bool Healthy;
        public readonly string Detail;
        public EngineHealthResult(bool healthy, string detail)
        { Healthy = healthy; Detail = detail ?? ""; }
    }

    sealed class InstallerDecision
    {
        public readonly InstallerCompletionState State;
        public readonly string Message;
        public readonly int ExitCode;
        public InstallerDecision(InstallerCompletionState state, string message, int exitCode)
        { State = state; Message = message ?? ""; ExitCode = exitCode; }
    }

    sealed class InstallerCompletion
    {
        private string _terminal;
        private string _terminalMessage;
        private DateTime? _doneAt;
        private DateTime? _exitedAt;
        private DateTime? _verificationAt;
        private InstallerDecision _final;

        public InstallerDecision Observe(string status, bool exited, int code,
            bool outputDrained, EngineHealthResult health, DateTime now)
        {
            if (_final != null) return _final;
            string line = (status ?? "").Trim().TrimStart('\uFEFF');
            int divider = line.IndexOf('|');
            if (divider >= 0)
            {
                string head = line.Substring(0, divider);
                string text = line.Substring(divider + 1).Trim();
                // ERR is authoritative; a stale progress/DONE write must not
                // turn a previously reported installation failure into success.
                if (head == "ERR") { _terminal = head; _terminalMessage = text; }
                else if (head == "DONE" && _terminal != "ERR")
                {
                    _terminal = head;
                    if (!_doneAt.HasValue) _doneAt = now;
                }
            }
            if (exited && !_exitedAt.HasValue) _exitedAt = now;
            if (_terminal == "ERR")
                return Finish(false, string.IsNullOrEmpty(_terminalMessage)
                    ? "O instalador informou uma falha. Abra o registro para ver os detalhes."
                    : _terminalMessage, code == 0 ? 1 : code);
            if (exited && code != 0)
            {
                // Let final ERR and stderr arrive before choosing the error
                // wording. Never report success for a nonzero exit code.
                if (!outputDrained && now - _exitedAt.Value < TimeSpan.FromSeconds(2))
                    return Pending(InstallerCompletionState.WaitingForOutput, "Lendo o resultado da instalação");
                return Finish(false, "O instalador encerrou com código " + code + ".", code);
            }
            if (!exited)
            {
                if (_doneAt.HasValue && now - _doneAt.Value > TimeSpan.FromSeconds(30))
                    return Finish(false, "A instalação informou conclusão, mas o processo não encerrou. Abra o registro para conferir o resultado.", 1);
                return Pending(_terminal == "DONE" ? InstallerCompletionState.WaitingForExit : InstallerCompletionState.Installing,
                    "Finalizando a instalação");
            }
            if (_terminal != "DONE")
            {
                if (now - _exitedAt.Value < TimeSpan.FromSeconds(3))
                    return Pending(InstallerCompletionState.WaitingForStatus, "Conferindo o resultado da instalação");
                return Finish(false, "O instalador encerrou sem confirmar a conclusão (código 0). Abra o registro para conferir o que aconteceu.", 1);
            }
            if (!outputDrained && now - _exitedAt.Value < TimeSpan.FromSeconds(2))
                return Pending(InstallerCompletionState.WaitingForOutput, "Finalizando o registro da instalação");
            if (!_verificationAt.HasValue) _verificationAt = now;
            if (health != null && health.Healthy)
                return Finish(true, health.Detail, 0);
            if (now - _verificationAt.Value >= TimeSpan.FromSeconds(30))
                return Finish(false, health != null && !string.IsNullOrEmpty(health.Detail)
                    ? health.Detail : "A instalação terminou, mas não foi possível confirmar o Motor online. Abra o registro para ver os detalhes.", 1);
            return Pending(InstallerCompletionState.Verifying, "Confirmando o Motor instalado");
        }

        private InstallerDecision Pending(InstallerCompletionState state, string message)
        { return new InstallerDecision(state, message, 0); }
        private InstallerDecision Finish(bool success, string message, int code)
        {
            _final = new InstallerDecision(success ? InstallerCompletionState.Success : InstallerCompletionState.Failure, message, code);
            return _final;
        }
    }

    static class InstallerEngineHealth
    {
        public static EngineHealthResult Check(string packagePath)
        {
#if REMOVER
            // Smart Remover's separate PowerShell protocol validates its ready
            // event. Do not apply Downloader's release metadata to that product.
            return new EngineHealthResult(true, "Smart Remover confirmou que o motor iniciou.");
#else
            string expected;
            try { expected = File.ReadAllText(Path.Combine(packagePath, "engine-version.txt")).Trim(); }
            catch (Exception ex) { return new EngineHealthResult(false, "O pacote não informa a versão do Motor: " + ex.Message); }
            if (!Regex.IsMatch(expected, @"^\d+\.\d+\.\d+(?:\.\d+)?$"))
                return new EngineHealthResult(false, "A versão do Motor no pacote é inválida. Baixe o instalador novamente.");
            string observed = "";
            for (int port = 47923; port <= 47931; port++)
            {
                try
                {
                    var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/health");
                    request.Proxy = null;
                    request.Timeout = 700;
                    request.ReadWriteTimeout = 700;
                    request.AllowAutoRedirect = false;
                    request.KeepAlive = false;
                    using (var response = (HttpWebResponse)request.GetResponse())
                    using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                    {
                        if (response.StatusCode != HttpStatusCode.OK) continue;
                        string body = reader.ReadToEnd();
                        if (!Regex.IsMatch(body, "\"app\"\\s*:\\s*\"darkolab-downloader-engine\"")) continue;
                        var version = Regex.Match(body, "\"version\"\\s*:\\s*\"([^\"]+)\"");
                        string found = version.Success ? version.Groups[1].Value : "desconhecida";
                        observed = "Foi encontrado o Motor " + found + ", mas esta instalação precisa da versão " + expected + ".";
                        if (found == expected && Regex.IsMatch(body, "\"capabilities\"\\s*:\\s*\\[[^\\]]*\"download-jobs-v1\""))
                            return new EngineHealthResult(true, "Motor " + expected + " online na porta " + port + ".");
                        if (found == expected) observed = "O Motor " + expected + " respondeu sem o suporte a downloads desta versão.";
                    }
                }
                catch (WebException) { }
                catch (IOException) { }
            }
            return new EngineHealthResult(false, string.IsNullOrEmpty(observed)
                ? "A instalação terminou, mas o Motor " + expected + " ainda não respondeu. Abra o registro para conferir a inicialização."
                : observed);
#endif
        }
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
        private FlatButton _btnFinalize;
        private Image _logoImg;
        private string _logPath;
        private string _installDst;
        private int _animTick;
        private bool _finished;
        private string _lastBaseStatus = "Iniciando";
        private readonly InstallerCompletion _completion = new InstallerCompletion();
        private readonly Func<EngineHealthResult> _healthProbe;
        private readonly object _diagnosticLock = new object();
        private string _sessionLogPath;
        private string _lastStderr = "";
        private string _lastStatusLine;
        private volatile bool _stdoutClosed;
        private volatile bool _stderrClosed;
        private volatile bool _healthRunning;
        private EngineHealthResult _healthResult;
        private DateTime _nextHealthProbe = DateTime.MinValue;
        private ToolTip _detailsTip;
        public int ResultCode { get; private set; }

        public InstallerForm(string tmp, string statusPath)
            : this(tmp, statusPath, null)
        { }

        public InstallerForm(string tmp, string statusPath, Func<EngineHealthResult> healthProbe)
        {
            _tmp = tmp;
            _statusPath = statusPath;
            _healthProbe = healthProbe ?? delegate { return InstallerEngineHealth.Check(_tmp); };
            ResultCode = 1;
            _installDst = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                Brand.InstallDir);
            _logPath = Path.Combine(_installDst, "install.log");
            try
            {
                Directory.CreateDirectory(_installDst);
                _sessionLogPath = Path.Combine(_installDst, "install-ui-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Process.GetCurrentProcess().Id + ".log");
                File.WriteAllText(_sessionLogPath, "Auto Edit installer diagnostics\r\n", Encoding.UTF8);
            }
            catch
            {
                string fallbackLogs = Path.Combine(Path.GetTempPath(), "AutoEditInstallerLogs");
                Directory.CreateDirectory(fallbackLogs);
                _sessionLogPath = Path.Combine(fallbackLogs, "install-ui-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Process.GetCurrentProcess().Id + ".log");
                File.WriteAllText(_sessionLogPath, "Auto Edit installer diagnostics\r\n", Encoding.UTF8);
            }
            LogDiagnostic("setup", "Package: " + _tmp + "; status: " + _statusPath + "; PowerShell log: " + _logPath);
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
                Text = "v" + Assembly.GetExecutingAssembly().GetName().Version.ToString(3) + "  ·  local",
                ForeColor = Theme.TextDim,
                Font = new Font("Consolas", 9f, FontStyle.Regular),
                AutoSize = true,
                BackColor = Color.Transparent,
                UseCompatibleTextRendering = false,
                Location = new Point(PAD_X, footerY + 4),
            };
            Controls.Add(version);

            var logsButton = MakeButton("Ver registro", 126, footerY);
            logsButton.Left = PAD_X + 150;
            logsButton.Click += delegate
            {
                try { Process.Start(new ProcessStartInfo("notepad.exe", "\"" + _sessionLogPath + "\"") { UseShellExecute = true }); }
                catch (Exception ex) { MessageBox.Show("Registro: " + _sessionLogPath + "\r\n" + ex.Message, "Auto Edit"); }
            };
            Controls.Add(logsButton);
            _detailsTip = new ToolTip { AutoPopDelay = 30000, InitialDelay = 300 };

            // Botão único "Finalizar" — primary violet, alinhado à direita.
            // Aparece SÓ quando termina (DONE ou ERR no status).
            _btnFinalize = MakeButton("Finalizar", 132, footerY);
            _btnFinalize.Left = (PAD_X + CONTENT_W) - _btnFinalize.Width;
            _btnFinalize.FillColor = Theme.Violet;
            _btnFinalize.FillHover = Theme.FuchsiaSoft;
            _btnFinalize.BorderNormal = Theme.Violet;
            _btnFinalize.BorderHover = Theme.Fuchsia;
            _btnFinalize.ForeColor = Theme.Bg;
            _btnFinalize.BackColor = _btnFinalize.FillColor;
            _btnFinalize.FlatAppearance.BorderColor = _btnFinalize.BorderNormal;
            _btnFinalize.Visible = false;
            _btnFinalize.Click += delegate(object s, EventArgs e) { Close(); };
            Controls.Add(_btnFinalize);

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
                if (!_finished) _tmr.Start();
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
                FinishInstallation(new InstallerDecision(InstallerCompletionState.Failure,
                    "Arquivo de instalação não encontrado no pacote. Baixe o instalador novamente.", 2));
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
                _psProc = new Process { StartInfo = psi };
                _psProc.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data == null) _stdoutClosed = true;
                    else LogDiagnostic("stdout", e.Data);
                };
                _psProc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data == null) _stderrClosed = true;
                    else
                    {
                        if (!string.IsNullOrWhiteSpace(e.Data)) lock (_diagnosticLock) _lastStderr = e.Data;
                        LogDiagnostic("stderr", e.Data);
                    }
                };
                if (!_psProc.Start()) throw new InvalidOperationException("Não foi possível iniciar o processo de instalação.");
                LogDiagnostic("setup", "PowerShell PID " + _psProc.Id);
                _psProc.BeginOutputReadLine();
                _psProc.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                LogDiagnostic("launch-error", ex.ToString());
                FinishInstallation(new InstallerDecision(InstallerCompletionState.Failure,
                    "Não foi possível iniciar o instalador: " + ex.Message, 1));
            }
        }

        void LogDiagnostic(string source, string message)
        {
            lock (_diagnosticLock)
            {
                try { File.AppendAllText(_sessionLogPath, DateTime.UtcNow.ToString("o") + " [" + source + "] " + message + "\r\n", Encoding.UTF8); }
                catch { /* Diagnostics must not replace the installation result. */ }
            }
        }

        void FinishInstallation(InstallerDecision decision)
        {
            if (_finished) return;
            _finished = true;
            ResultCode = decision.State == InstallerCompletionState.Success ? 0 : (decision.ExitCode == 0 ? 1 : decision.ExitCode);
            if (_tmr != null) _tmr.Stop();
            var pct = (Label)Controls["progressPct"];
            bool success = ResultCode == 0;
            string message = decision.Message;
            if (!success)
            {
                string stderr;
                lock (_diagnosticLock) stderr = _lastStderr;
                if (!string.IsNullOrWhiteSpace(stderr) && !message.Contains(stderr)) message += " " + stderr;
                LogDiagnostic("result", "FAILED; exit=" + ResultCode + "; " + message);
            }
            else LogDiagnostic("result", "SUCCESS; " + message);
            if (pct != null)
            {
                pct.Text = success ? "100%" : "Erro";
                pct.ForeColor = success ? Theme.Violet : Theme.Danger;
                pct.Left = PAD_X + CONTENT_W - pct.PreferredSize.Width;
            }
            if (success) _progress.Value = 1f;
            _statusLbl.Text = success ? "Instalação concluída" : "Não foi possível concluir";
            _statusLbl.ForeColor = success ? Theme.Text : Theme.Danger;
            string compact = Regex.Replace(message, @"\s+", " ").Trim();
            _hintLbl.Text = success ? "Motor pronto. Abra o Downloader no Auto Edit para continuar."
                : (compact.Length > 185 ? compact.Substring(0, 185) + "…" : compact) + "\r\nVer registro mostra os detalhes desta instalação.";
#if REMOVER
            if (success) _hintLbl.Text = "Motor pronto. Abra o Smart Remover no Auto Edit para continuar.";
#endif
            if (_detailsTip != null) _detailsTip.SetToolTip(_hintLbl, message + "\r\nRegistro: " + _sessionLogPath);
            _btnFinalize.Visible = true;
        }

        // The timer reads the terminal status BEFORE reconciling process exit.
        // This handles DONE + exit 0 within one tick, atomic-file replacement,
        // delayed stdout/stderr delivery, and an actually failed PowerShell.
        void OnTick(object sender, EventArgs e)
        {
            if (_finished) return;
            _animTick++;
            string line = null;
            try
            {
                using (var stream = new FileStream(_statusPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(stream, Encoding.UTF8, true)) line = reader.ReadToEnd().Trim();
            }
            catch (IOException) { /* A replacing writer can briefly hide/lock the file. */ }
            catch (UnauthorizedAccessException ex) { LogDiagnostic("status-read", ex.Message); }
            if (!string.IsNullOrEmpty(line) && line != _lastStatusLine)
            {
                _lastStatusLine = line;
                LogDiagnostic("status", line);
            }
            bool exited = false;
            int code = 0;
            try
            {
                exited = _psProc != null && _psProc.HasExited;
                if (exited) code = _psProc.ExitCode;
            }
            catch (InvalidOperationException ex)
            {
                FinishInstallation(new InstallerDecision(InstallerCompletionState.Failure,
                    "Não foi possível acompanhar o processo de instalação: " + ex.Message, 1));
                return;
            }
            EngineHealthResult health;
            lock (_diagnosticLock) health = _healthResult;
            InstallerDecision decision = _completion.Observe(line, exited, code,
                _stdoutClosed && _stderrClosed, health, DateTime.UtcNow);
            if (decision.State == InstallerCompletionState.Success || decision.State == InstallerCompletionState.Failure)
            {
                FinishInstallation(decision);
                return;
            }
            if (decision.State == InstallerCompletionState.Verifying)
            {
                if (!_healthRunning && DateTime.UtcNow >= _nextHealthProbe)
                {
                    _healthRunning = true;
                    _nextHealthProbe = DateTime.UtcNow.AddSeconds(1);
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        EngineHealthResult result;
                        try { result = _healthProbe(); }
                        catch (Exception ex) { result = new EngineHealthResult(false, "Não foi possível verificar o Motor: " + ex.Message); }
                        lock (_diagnosticLock) _healthResult = result;
                        LogDiagnostic("health", result.Detail);
                        _healthRunning = false;
                    });
                }
            }
            if (decision.State != InstallerCompletionState.Installing)
            {
                _lastBaseStatus = decision.Message;
                _progress.Value = Math.Min(_progress.Value, 0.99f);
                _hintLbl.Text = "Confirmando o resultado antes de finalizar. O registro permanece disponível abaixo.";
            }
            else if (!string.IsNullOrEmpty(line))
            {
                int divider = line.IndexOf('|');
                int percent;
                if (divider >= 0 && int.TryParse(line.Substring(0, divider), out percent))
                {
                    percent = Math.Max(0, Math.Min(99, percent));
                    _progress.Value = Math.Max(0.02f, percent / 100f);
                    var pct = (Label)Controls["progressPct"];
                    if (pct != null) { pct.Text = percent + "%"; pct.Left = PAD_X + CONTENT_W - pct.PreferredSize.Width; }
                    _lastBaseStatus = line.Substring(divider + 1).TrimEnd('.', ' ');
                }
            }
            _statusLbl.Text = _lastBaseStatus + new string('.', (_animTick / 4) % 4);
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
                int resultCode;
                using (var form = new InstallerForm(tmp, statusPath))
                {
                    Application.Run(form);
                    resultCode = form.ResultCode;
                }

                try { File.Delete(statusPath); } catch { }
                try { Directory.Delete(tmp, true); } catch { }
                return resultCode;
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
