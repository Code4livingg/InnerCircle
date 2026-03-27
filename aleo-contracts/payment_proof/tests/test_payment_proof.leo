import sub_invoice_v8_xwnxp.aleo;

program test_payment_proof.aleo {
    @test
    transition nullifier_repeatable() {
        let nullifier_one: field = sub_invoice_v8_xwnxp.aleo/compute_invoice_nullifier(
            aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl,
            123field,
            200u32,
            999field,
        );
        let nullifier_two: field = sub_invoice_v8_xwnxp.aleo/compute_invoice_nullifier(
            aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl,
            123field,
            200u32,
            999field,
        );

        assert_eq(nullifier_one, nullifier_two);
    }

    @test
    @should_fail
    transition nullifier_uses_salt() {
        let nullifier_one: field = sub_invoice_v8_xwnxp.aleo/compute_invoice_nullifier(
            aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl,
            123field,
            200u32,
            111field,
        );
        let nullifier_two: field = sub_invoice_v8_xwnxp.aleo/compute_invoice_nullifier(
            aleo179k9x8m793zgxv5x5w00huef7q73uw0jfne6mtcgu574n5leuczqjd43yl,
            123field,
            200u32,
            222field,
        );

        assert_eq(nullifier_one, nullifier_two);
    }
}
