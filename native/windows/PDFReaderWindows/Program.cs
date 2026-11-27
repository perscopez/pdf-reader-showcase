using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;

namespace PDFReaderWindows;

static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

public class MainForm : Form
{
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly Panel topBar = new() { Dock = DockStyle.Top, Height = 38, BackColor = Color.FromArgb(14, 18, 28), Visible = false };
    private readonly TextBox urlBox = new() { Width = 450, Font = new Font("Segoe UI", 10), BackColor = Color.FromArgb(30, 41, 59), ForeColor = Color.White, BorderStyle = BorderStyle.FixedSingle };
    private readonly Button goButton = new() { Text = "Yenile/Git", Width = 90, Height = 26, FlatStyle = FlatStyle.Flat, ForeColor = Color.White };
    private readonly Button toggleBarButton = new() { Text = "🌐 Sunucu URL", Width = 110, Height = 28, FlatStyle = FlatStyle.Flat, ForeColor = Color.White, Dock = DockStyle.Right };
    private string currentUrl = "https://library.example.com";

    public MainForm()
    {
        Text = "Dijital Kütüphane";
        Size = new Size(1280, 800);
        MinimumSize = new Size(800, 600);
        BackColor = Color.FromArgb(8, 10, 16);

        urlBox.Text = currentUrl;
        urlBox.Location = new Point(12, 6);
        goButton.Location = new Point(470, 5);

        topBar.Controls.Add(urlBox);
        topBar.Controls.Add(goButton);
        
        var header = new Panel { Dock = DockStyle.Top, Height = 32, BackColor = Color.FromArgb(10, 13, 20) };
        var title = new Label { Text = "Dijital Kütüphane (Native Windows)", ForeColor = Color.White, Font = new Font("Segoe UI", 10, FontStyle.Bold), AutoSize = true, Location = new Point(12, 6) };
        header.Controls.Add(title);
        header.Controls.Add(toggleBarButton);

        Controls.Add(webView);
        Controls.Add(topBar);
        Controls.Add(header);

        toggleBarButton.Click += (_, _) => { topBar.Visible = !topBar.Visible; };
        goButton.Click += (_, _) => { Navigate(urlBox.Text); };
        urlBox.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; Navigate(urlBox.Text); } };

        Load += async (_, _) =>
        {
            try
            {
                await webView.EnsureCoreWebView2Async(null);
                webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
                webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
                Navigate(currentUrl);
            }
            catch (Exception ex)
            {
                MessageBox.Show($"WebView2 başlatılamadı: {ex.Message}\nLütfen Microsoft Edge WebView2 Runtime yüklü olduğundan emin olun.", "Hata", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        };
    }

    private void Navigate(string url)
    {
        if (!url.StartsWith("http://") && !url.StartsWith("https://"))
        {
            url = "https://" + url;
        }
        currentUrl = url;
        urlBox.Text = url;
        if (webView.CoreWebView2 != null)
        {
            webView.CoreWebView2.Navigate(url);
        }
    }
}
