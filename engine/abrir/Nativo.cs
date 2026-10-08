// Chamadas do Windows que o .NET não expõe: janelas de outro programa,
// foco, clique e a pasta Downloads do usuário.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace AutoEditAbrir
{
    static class Nativo
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        // INPUT do SendInput: no x64 tem 40 bytes (type + 4 de alinhamento + MOUSEINPUT).
        // Tamanho errado = o Windows recusa CALADO (retorna 0).
        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public MOUSEINPUT mi; }

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
        [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
        [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
        [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO info);

        /// <summary>Quando ESTE app mexeu no mouse/teclado pela última vez (tick).</summary>
        static int ultimaInjecao = Environment.TickCount - 100000;

        /// <summary>
        /// A pessoa mexeu no mouse ou no teclado nos últimos `ms`? (descontando o
        /// que o próprio app fez). Clicar enquanto ela usa o PC = o clique pode
        /// cair em outra janela — então o app espera ela parar.
        /// </summary>
        public static bool PessoaMexendo(int ms)
        {
            var info = new LASTINPUTINFO();
            info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
            if (!GetLastInputInfo(ref info)) return false;
            int agora = Environment.TickCount;
            int ultima = (int)info.dwTime;
            if (agora - ultima > ms) return false;
            return ultima - ultimaInjecao > 250; // a última entrada não foi nossa
        }

        /// <summary>A janela de cima (raiz) no ponto da tela.</summary>
        public static IntPtr JanelaNoPonto(int x, int y)
        {
            var p = new POINT { X = x, Y = y };
            IntPtr h = WindowFromPoint(p);
            return h == IntPtr.Zero ? h : GetAncestor(h, 2 /* GA_ROOT */);
        }
        [DllImport("shell32.dll")] static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);
        [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);

        public const int SW_RESTORE = 9;
        public const int SW_MAXIMIZE = 3;

        /// <summary>Pixels físicos em todo monitor (o manifest já pede; isto garante).</summary>
        public static void LigarDpi()
        {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return; } catch { }
            try { SetProcessDpiAwareness(2); } catch { }
        }

        /// <summary>A pasta Downloads de verdade (o usuário pode ter mudado de lugar).</summary>
        public static string PastaDownloads()
        {
            try
            {
                IntPtr p;
                if (SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out p) == 0)
                {
                    string s = Marshal.PtrToStringUni(p);
                    Marshal.FreeCoTaskMem(p);
                    return s;
                }
            }
            catch { }
            return System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        }

        public static string Titulo(IntPtr h)
        {
            var sb = new StringBuilder(256);
            GetWindowText(h, sb, 256);
            return sb.ToString();
        }

        public static Rectangle Retangulo(IntPtr h)
        {
            RECT r;
            if (!GetWindowRect(h, out r)) return Rectangle.Empty;
            return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        }

        /// <summary>Janelas visíveis dos processos com este nome (ex.: "CapCut").</summary>
        public static List<IntPtr> JanelasDoProcesso(string nomeDoProcesso)
        {
            var pids = new HashSet<uint>();
            foreach (var p in Process.GetProcessesByName(nomeDoProcesso))
            {
                try { pids.Add((uint)p.Id); } catch { }
                p.Dispose();
            }
            var lista = new List<IntPtr>();
            if (pids.Count == 0) return lista;
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (pids.Contains(pid) && IsWindowVisible(h)) lista.Add(h);
                return true;
            }, IntPtr.Zero);
            return lista;
        }

        public static uint PidDaJanela(IntPtr h)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            return pid;
        }

        /// <summary>
        /// Traz a janela pra frente. 1º jeito limpo (liga a fila de entrada da
        /// janela da frente à nossa, sem tecla nenhuma); só se o Windows recusar,
        /// o "toque do ALT" — que não chega a nenhum programa como atalho.
        /// </summary>
        public static bool TrazerPraFrente(IntPtr h)
        {
            if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
            for (int i = 0; i < 4; i++)
            {
                if (GetForegroundWindow() == h) return true;
                try { AllowSetForegroundWindow((int)PidDaJanela(h)); } catch { }
                IntPtr frente = GetForegroundWindow();
                uint pidFrente;
                uint threadFrente = frente == IntPtr.Zero ? 0 : GetWindowThreadProcessId(frente, out pidFrente);
                uint eu = GetCurrentThreadId();
                bool ligado = threadFrente != 0 && threadFrente != eu && AttachThreadInput(eu, threadFrente, true);
                try
                {
                    BringWindowToTop(h);
                    SetForegroundWindow(h);
                }
                finally { if (ligado) AttachThreadInput(eu, threadFrente, false); }
                Thread.Sleep(200);
                if (GetForegroundWindow() == h) return true;
                if (i >= 1)
                {
                    ultimaInjecao = Environment.TickCount;
                    keybd_event(0x12, 0, 0, UIntPtr.Zero);       // ALT desce
                    keybd_event(0x12, 0, 0x0002, UIntPtr.Zero);  // ALT sobe
                    SetForegroundWindow(h);
                    Thread.Sleep(250);
                }
            }
            return GetForegroundWindow() == h;
        }

        /// <summary>
        /// UM clique real com o botão esquerdo em (x, y) — pixels físicos — e o
        /// cursor volta pro lugar. O CapCut (Qt 6) ignora clique "de mentira"
        /// por mensagem: ele confere o estado real do botão.
        /// </summary>
        public static bool Clicar(int x, int y, IntPtr janelaEsperada)
        {
            POINT antes;
            bool tinha = GetCursorPos(out antes);
            ultimaInjecao = Environment.TickCount;
            SetCursorPos(x - 5, y - 5);
            Thread.Sleep(90);
            SetCursorPos(x, y);
            ultimaInjecao = Environment.TickCount;
            Thread.Sleep(120);
            // TRAVA: só aperta se o que está debaixo do cursor É a janela certa e
            // ela está na frente — senão o clique cairia em outro programa.
            bool certo = JanelaNoPonto(x, y) == janelaEsperada && GetForegroundWindow() == janelaEsperada;
            uint a = 0, b = 0;
            if (certo)
            {
                var ins = new INPUT[2];
                ins[0].type = 0; ins[0].mi.dwFlags = 0x0002; // LEFTDOWN
                ins[1].type = 0; ins[1].mi.dwFlags = 0x0004; // LEFTUP
                ultimaInjecao = Environment.TickCount;
                a = SendInput(1, new[] { ins[0] }, Marshal.SizeOf(typeof(INPUT)));
                Thread.Sleep(80);
                b = SendInput(1, new[] { ins[1] }, Marshal.SizeOf(typeof(INPUT)));
                ultimaInjecao = Environment.TickCount;
                Thread.Sleep(150);
            }
            if (tinha) SetCursorPos(antes.X, antes.Y);
            ultimaInjecao = Environment.TickCount;
            return certo && a == 1 && b == 1;
        }

        /// <summary>Print de um pedaço da tela (pixels físicos).</summary>
        public static Bitmap Capturar(Rectangle r)
        {
            var bmp = new Bitmap(Math.Max(1, r.Width), Math.Max(1, r.Height), System.Drawing.Imaging.PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(r.Left, r.Top, 0, 0, r.Size, CopyPixelOperation.SourceCopy);
            return bmp;
        }
    }
}
