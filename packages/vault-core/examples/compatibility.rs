use std::io::{self, Read};
fn main() {
    let mode = std::env::args().nth(1);
    if mode.as_deref() == Some("seal-transfer") {
        let mut input = String::new();
        io::stdin().read_to_string(&mut input).unwrap();
        let value: serde_json::Value = serde_json::from_str(&input).unwrap();
        let request =
            mailport_core::transfer::ImportRequest::parse(value["requestFile"].as_str().unwrap())
                .expect("Synthetic request must be valid");
        let accounts =
            serde_json::from_value::<Vec<mailport_core::Account>>(value["accounts"].clone())
                .expect("Synthetic accounts must be valid");
        let selected = mailport_core::select_accounts(
            &accounts,
            &serde_json::from_value::<Vec<String>>(value["ids"].clone()).unwrap(),
        )
        .expect("Synthetic selection must be valid");
        let package = request.seal(&selected).unwrap();
        println!(
            "{}",
            serde_json::json!({
                "verificationCode": request.verification_code(),
                "packageCode": mailport_core::transfer::package_code(&package),
                "package": package,
            })
        );
    } else if mode.as_deref() == Some("verify") {
        let mut input = String::new();
        io::stdin().read_to_string(&mut input).unwrap();
        let value: serde_json::Value = serde_json::from_str(&input).unwrap();
        let accounts = mailport_core::unlock(
            value["envelope"].as_str().unwrap(),
            value["password"].as_str().unwrap(),
        )
        .expect("Synthetic compatibility package must unlock");
        assert_eq!(serde_json::to_value(accounts).unwrap(), value["accounts"]);
        println!("Node-produced package accepted by Rust.");
    } else {
        let data: serde_json::Value =
            serde_json::from_str(include_str!("../../../docs/vectors/v1.json")).unwrap();
        let accounts: Vec<mailport_core::Account> =
            serde_json::from_value(data["accounts"].clone()).unwrap();
        println!(
            "{}",
            mailport_core::seal(&accounts, data["password"].as_str().unwrap()).unwrap()
        );
    }
}
