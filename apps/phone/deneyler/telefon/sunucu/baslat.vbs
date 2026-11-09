' Kullanici oturumunda penceresiz baslatir; pencere kapatilip olcum yanlislikla bitmesin.
Set k = CreateObject("WScript.Shell")
k.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
' node PATH'ten bulunur; farkli kurulumda EREN_KIT_NODE ile tam yol verilebilir.
node = k.ExpandEnvironmentStrings("%EREN_KIT_NODE%")
If node = "%EREN_KIT_NODE%" Or node = "" Then node = "node"
k.Run "cmd /c """"" & node & """ sunucu.js >> sunucu.out.log 2>&1""", 0, False
