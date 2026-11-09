# Deterministic WinForms target for integration tests. Run with Windows PowerShell 5.1:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File test_form.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace CUW -Name Dpi -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][CUW.Dpi]::SetProcessDPIAware()
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'CUW Test Form'
$form.TopMost = $true
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point(100, 100)
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None
$form.ClientSize = New-Object System.Drawing.Size(500, 350)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$font = New-Object System.Drawing.Font('Segoe UI', 11)
$form.Font = $font

function Add-Caption($text, $y) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.AutoSize = $true
    $l.Location = New-Object System.Drawing.Point(20, $y)
    $l.AccessibleName = "$text caption"
    $form.Controls.Add($l)
}

Add-Caption 'Input' 22
$tbInput = New-Object System.Windows.Forms.TextBox
$tbInput.AccessibleName = 'Input'
$tbInput.Location = New-Object System.Drawing.Point(130, 18)
$tbInput.Size = New-Object System.Drawing.Size(330, 30)
$form.Controls.Add($tbInput)

Add-Caption 'Secret' 72
$tbSecret = New-Object System.Windows.Forms.TextBox
$tbSecret.AccessibleName = 'Secret'
$tbSecret.UseSystemPasswordChar = $true
$tbSecret.Location = New-Object System.Drawing.Point(130, 68)
$tbSecret.Size = New-Object System.Drawing.Size(330, 30)
$form.Controls.Add($tbSecret)

$chkAgree = New-Object System.Windows.Forms.CheckBox
$chkAgree.Text = 'Agree'
$chkAgree.AccessibleName = 'Agree'
$chkAgree.AutoSize = $true
$chkAgree.Location = New-Object System.Drawing.Point(20, 120)
$form.Controls.Add($chkAgree)

$btnSubmit = New-Object System.Windows.Forms.Button
$btnSubmit.Text = 'Submit'
$btnSubmit.AccessibleName = 'Submit'
$btnSubmit.Location = New-Object System.Drawing.Point(20, 170)
$btnSubmit.Size = New-Object System.Drawing.Size(140, 40)
$form.Controls.Add($btnSubmit)

$lblResult = New-Object System.Windows.Forms.Label
$lblResult.Text = 'waiting'
$lblResult.AccessibleName = 'Result'
$lblResult.AccessibleDescription = 'waiting'
$lblResult.AutoSize = $false
$lblResult.Location = New-Object System.Drawing.Point(20, 240)
$lblResult.Size = New-Object System.Drawing.Size(450, 40)
$form.Controls.Add($lblResult)

$btnSubmit.Add_Click({
    $script:lblResult.Text = 'got:' + $script:tbInput.Text
    $script:lblResult.AccessibleDescription = $script:lblResult.Text
})

[void][System.Windows.Forms.Application]::Run($form)
