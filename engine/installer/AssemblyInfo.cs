// AssemblyInfo — metadata visível pro Windows Explorer + antivírus.
//
// Antivírus heurísticos consideram "binário sem metadata" como suspeito.
// Preencher CompanyName, FileDescription, ProductName, Version reduz
// drasticamente o score de suspeita do Defender/Avast/Kaspersky.

using System.Reflection;
using System.Runtime.InteropServices;

#if REMOVER
[assembly: AssemblyTitle("Auto Edit Smart Remover Setup")]
[assembly: AssemblyDescription("Instalador do motor local do Auto Edit Smart Remover — baixa Python, PaddleOCR, LaMa e ffmpeg para uso offline.")]
[assembly: AssemblyProduct("Auto Edit Smart Remover")]
#else
[assembly: AssemblyTitle("Auto Edit Downloader Setup")]
[assembly: AssemblyDescription("Instalador do motor local do Auto Edit Downloader — baixa Node, ffmpeg, yt-dlp e Chromium para uso offline.")]
[assembly: AssemblyProduct("Auto Edit Downloader")]
#endif
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCompany("Auto Edit")]
[assembly: AssemblyCopyright("Copyright (c) Auto Edit 2026")]
[assembly: AssemblyTrademark("")]
[assembly: AssemblyCulture("")]

[assembly: ComVisible(false)]
[assembly: Guid("a9c8b7d2-3e4f-4a1b-9c8d-7e6f5a4b3c2d")]

[assembly: AssemblyVersion("3.0.0.0")]
[assembly: AssemblyFileVersion("3.0.0.0")]
[assembly: AssemblyInformationalVersion("3.0.0")]
