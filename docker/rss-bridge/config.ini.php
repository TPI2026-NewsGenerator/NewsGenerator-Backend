; <?php exit; ?> DO NOT REMOVE THIS LINE

; Configuration of the RSS-Bridge of the project (see docker-compose.yml).
;
; Only CssSelectorBridge is enabled: it is the one that reads a page and gives back its articles,
; the only one this project uses. Every other bridge (social networks, video platforms) would be an
; open door on a service answering on this machine.
;
; Every key here exists in config.default.ini.php of RSS-Bridge. An unknown key, or a value of the
; wrong type, makes every request answer "500 Config [...] is invalid".

[system]

env = "prod"

enabled_bridges[] = CssSelectorBridge

timezone = "UTC"

[http]

; the bridge reads the page of the site then one page per article, a slow site needs more than
; the 5 seconds of the default configuration
timeout = 15

retries = 2

useragent = "Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)"

[cache]

type = "file"
