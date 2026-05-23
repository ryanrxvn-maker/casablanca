// Utilitario de build: converte PNGs (16/32/48/128) num icon.ico
// CLASSICO (BMP DIB) — formato que o Windows Explorer e o csc.exe leem
// 100% das vezes (PNG-embedded ICO pode falhar em alguns parsers).
//
// Uso: MakeIco.exe <out.ico> <png16> <png32> <png48> <png128>
//
// Compilado com csc.exe do .NET Framework 4 (sempre presente no Win).

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace DarkoLab
{
    static class MakeIco
    {
        static int Main(string[] args)
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("uso: MakeIco.exe <out.ico> <png1> [<png2> ...]");
                return 2;
            }
            string outPath = args[0];

            var dibs = new List<byte[]>();
            var sizes = new List<int>();
            for (int i = 1; i < args.Length; i++)
            {
                using (var src = (Bitmap)Image.FromFile(args[i]))
                {
                    int w = src.Width, h = src.Height;
                    // Garante 32bpp ARGB
                    using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                    {
                        using (var g = Graphics.FromImage(bmp))
                        {
                            g.Clear(Color.Transparent);
                            g.DrawImage(src, 0, 0, w, h);
                        }
                        dibs.Add(BuildDib(bmp));
                        sizes.Add(w);
                    }
                }
            }

            using (var fs = File.Create(outPath))
            using (var bw = new BinaryWriter(fs))
            {
                // ICONDIR
                bw.Write((ushort)0);          // reserved
                bw.Write((ushort)1);          // type ICO
                bw.Write((ushort)dibs.Count); // count

                int offset = 6 + dibs.Count * 16;
                for (int i = 0; i < dibs.Count; i++)
                {
                    int s = sizes[i];
                    bw.Write((byte)(s >= 256 ? 0 : s)); // width
                    bw.Write((byte)(s >= 256 ? 0 : s)); // height
                    bw.Write((byte)0);                  // colorCount
                    bw.Write((byte)0);                  // reserved
                    bw.Write((ushort)1);                // planes
                    bw.Write((ushort)32);               // bitCount
                    bw.Write((uint)dibs[i].Length);     // bytesInRes
                    bw.Write((uint)offset);             // imageOffset
                    offset += dibs[i].Length;
                }
                foreach (var b in dibs) bw.Write(b);
            }
            return 0;
        }

        // DIB para ICO: BITMAPINFOHEADER (h*2 — top mask) + pixels BGRA
        // bottom-up + AND mask (pode ser zeros em 32bpp, alpha cobre).
        static byte[] BuildDib(Bitmap bmp)
        {
            int w = bmp.Width, h = bmp.Height;
            // Pixels
            var rect = new Rectangle(0, 0, w, h);
            var data = bmp.LockBits(rect, ImageLockMode.ReadOnly,
                PixelFormat.Format32bppArgb);
            int stride = data.Stride;
            byte[] src = new byte[stride * h];
            System.Runtime.InteropServices.Marshal.Copy(
                data.Scan0, src, 0, src.Length);
            bmp.UnlockBits(data);

            // bottom-up
            byte[] pixels = new byte[w * h * 4];
            for (int y = 0; y < h; y++)
            {
                Buffer.BlockCopy(src, y * stride,
                    pixels, (h - 1 - y) * w * 4, w * 4);
            }

            int maskStride = ((w + 31) / 32) * 4;
            byte[] mask = new byte[maskStride * h]; // zeros = todos opacos

            using (var ms = new MemoryStream())
            using (var bw = new BinaryWriter(ms))
            {
                // BITMAPINFOHEADER (40 bytes)
                bw.Write((uint)40);     // biSize
                bw.Write((int)w);       // biWidth
                bw.Write((int)(h * 2)); // biHeight = h*2 (mask)
                bw.Write((ushort)1);    // biPlanes
                bw.Write((ushort)32);   // biBitCount
                bw.Write((uint)0);      // biCompression BI_RGB
                bw.Write((uint)0);      // biSizeImage
                bw.Write((int)0);       // biXPelsPerMeter
                bw.Write((int)0);       // biYPelsPerMeter
                bw.Write((uint)0);      // biClrUsed
                bw.Write((uint)0);      // biClrImportant
                bw.Write(pixels);
                bw.Write(mask);
                return ms.ToArray();
            }
        }
    }
}
