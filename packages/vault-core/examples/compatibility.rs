use std::io::{self, Read};
fn main() {
    if std::env::args().nth(1).as_deref() == Some("verify") {
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
