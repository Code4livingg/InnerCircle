// The 'test_access_pass' test program.
import access_pass.aleo;
program test_access_pass.aleo {
    @test
    script test_it() {
        let result: u32 = access_pass.aleo/main(1u32, 2u32);
        assert_eq(result, 3u32);
    }

    @test
    @should_fail
    transition do_nothing() {
        let result: u32 = access_pass.aleo/main(2u32, 3u32);
        assert_eq(result, 3u32);
    }

    @noupgrade
    async constructor() {}
}
